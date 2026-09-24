import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BOT_MIN_BID_TZS,
  BOT_TOKEN_LIFETIME_SECONDS,
  PemRequestSigner,
  botTimestamp,
  canonicalString,
  isTimestampFresh,
  isValidBatchReference,
  parseBatchReference,
  verifyBotSignature,
} from '@govsec/bot-client';
import { seedAuctions } from './seed';

/**
 * A local stand-in for the Bank of Tanzania GSS Bidding API (BOT-SPEC-GSS-2026-v1.0).
 *
 * It exists so bot-gateway can be built and tested end to end before BoT issues
 * sandbox credentials. It follows the specification as written — including its gaps:
 * auctions carry no cut-off time (B4), there is no cancel endpoint (B3), and /winners
 * does not say whose allotment is whose (B1). Code that works against the simulator
 * therefore already copes with what the real API does not provide.
 *
 * Development and testing only. It keeps everything in memory and trusts its own
 * `/_sim/*` controls without authentication.
 */

export interface SimParticipant {
  /** Name BoT shows as `investor` on bids and winners. */
  displayName: string;
  username: string;
  senderCode: string;
  interfaceCode: string;
  apiKey: string;
  /** The participant's public key, exchanged at onboarding. */
  publicKeyPem: string;
  /** The 8-character code every batch reference must start with. */
  participantCode: string;
  /** Where BoT posts callbacks for this participant. */
  callbackUrl?: string;
}

export interface SimAuction {
  ISIN: string;
  securityName: string;
  instrumentType: 'TBILLS' | 'TBONDS';
  auctionDate: string;
  maturityDate: string;
  tenderedSizeCompetitive: number;
  tenderedSizeNonCompetitive: number;
  status: 'OPEN' | 'CLOSED';
  /** Internal only; the AuctionItem schema has no cut-off field (B4). */
  cutoffAt: Date;
}

export type SimBidAction = 'initiated' | 'processing' | 'accepted' | 'rejected';

export interface SimBid {
  requestId: string;
  batchReference: string;
  participant: string;
  ISIN: string;
  securityAccount: string;
  amount: number;
  /** Hundredths of a price point, so comparisons are exact: 99.50 → 9950. */
  priceHundredths: number;
  competitive: 'Y' | 'N';
  action: SimBidAction;
  remarks: string;
  receivedAt: string;
  allottedAmount?: number;
  allottedPriceHundredths?: number;
}

export interface SimCallbackDelivery {
  url: string;
  body: string;
  status: number | null;
  error?: string;
}

export interface BotSimulatorOptions {
  participants: SimParticipant[];
  /** The simulator's private key, standing in for BoT's. Callbacks are signed with it. */
  botPrivateKeyPem: string;
  auctions?: SimAuction[];
  /** Override the clock (tests). */
  now?: () => Date;
  tokenLifetimeSeconds?: number;
  log?: (message: string) => void;
}

class SimError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Session {
  participant: SimParticipant;
  expiresAt: number;
}

const PRICE = /^\d{1,3}(\.\d{1,2})?$/;

export class BotSimulator {
  readonly auctions: SimAuction[];
  readonly bids: SimBid[] = [];
  readonly callbacks: SimCallbackDelivery[] = [];
  private readonly batches = new Set<string>();
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Set<Promise<void>>();
  private readonly signer: PemRequestSigner;
  private readonly now: () => Date;
  private readonly tokenLifetime: number;
  private readonly log: (message: string) => void;
  private server: Server | null = null;

  constructor(private readonly options: BotSimulatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.auctions = options.auctions ?? seedAuctions(this.now());
    this.signer = new PemRequestSigner(options.botPrivateKeyPem);
    this.tokenLifetime = options.tokenLifetimeSeconds ?? BOT_TOKEN_LIFETIME_SECONDS;
    this.log = options.log ?? (() => undefined);
  }

  // ------------------------------------------------------------------ lifecycle

  /** Starts listening. Port 0 picks a free port; the base URL is returned. */
  async start(port = 0, host = '127.0.0.1'): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server?.listen(port, host, resolve));
    const address = this.server.address() as AddressInfo;
    return `http://${host}:${address.port}`;
  }

  async stop(): Promise<void> {
    await this.settle();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }

  /** Waits for every callback in flight. Tests call this before asserting. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** Expires every token, to exercise re-authentication. */
  expireTokens(): void {
    for (const session of this.sessions.values()) session.expiresAt = 0;
  }

  // ------------------------------------------------------------------ auction close

  /**
   * Runs the auction for one ISIN at a cut-off price and sends the callbacks.
   *
   * Competitive bids at or above the cut-off are allotted in full at their own price;
   * those below are unsuccessful. Non-competitive bids are allotted at the weighted
   * average price of the successful competitive bids. Pro-rata at the margin is not
   * simulated.
   */
  async closeAuction(
    isin: string,
    cutoffPrice: string,
  ): Promise<{ allotted: number; unsuccessful: number }> {
    const auction = this.auctions.find((a) => a.ISIN === isin);
    if (!auction) throw new SimError(404, 'AUCTION_NOT_FOUND', `No auction for ${isin}`);
    if (!PRICE.test(cutoffPrice))
      throw new SimError(400, 'INVALID_PRICE', 'Cut-off price must have at most two decimals');
    auction.status = 'CLOSED';
    const cutoff = toHundredths(cutoffPrice);

    const bids = this.bids.filter(
      (b) => b.ISIN === isin && (b.action === 'accepted' || b.action === 'initiated'),
    );
    const winners = bids.filter((b) => b.competitive === 'Y' && b.priceHundredths >= cutoff);
    const weightedTotal = winners.reduce((sum, b) => sum + b.priceHundredths * b.amount, 0);
    const winningFace = winners.reduce((sum, b) => sum + b.amount, 0);
    const wap = winningFace > 0 ? Math.round(weightedTotal / winningFace) : cutoff;

    let allotted = 0;
    let unsuccessful = 0;
    for (const bid of bids) {
      const success = bid.competitive === 'N' || bid.priceHundredths >= cutoff;
      bid.allottedAmount = success ? bid.amount : 0;
      bid.allottedPriceHundredths = success
        ? bid.competitive === 'N'
          ? wap
          : bid.priceHundredths
        : 0;
      bid.remarks = success ? 'Allotted' : 'Bid price below auction cut-off price';
      if (success) allotted += 1;
      else unsuccessful += 1;
      this.callback(
        bid,
        {
          status: success ? 'allotted' : 'unsuccessful',
          allottedAmount: bid.allottedAmount,
          // A JSON number, as in the spec's callback sample (B12).
          allottedPrice: bid.allottedPriceHundredths / 100,
          action: success ? 'approve' : 'reject',
        },
        `Bid batch ${bid.batchReference} processing completed successfully`,
      );
    }
    await this.settle();
    return { allotted, unsuccessful };
  }

  // ------------------------------------------------------------------ HTTP

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://sim');
    const pathAndQuery = `${url.pathname}${url.search}`;
    const method = (req.method ?? 'GET').toUpperCase();
    try {
      const [status, body] = await this.route(method, url, pathAndQuery, raw, req);
      send(res, status, body);
    } catch (error) {
      if (error instanceof SimError) {
        send(res, error.status, {
          status: 'error',
          code: error.code,
          message: error.message,
          timestamp: botTimestamp(this.now()),
          path: url.pathname,
        });
      } else {
        this.log(`simulator error: ${error instanceof Error ? error.message : String(error)}`);
        send(res, 500, { status: 'error', code: 'INTERNAL_ERROR', message: 'Simulator failure' });
      }
    }
  }

  private async route(
    method: string,
    url: URL,
    pathAndQuery: string,
    raw: string,
    req: IncomingMessage,
  ): Promise<[number, unknown]> {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    // Simulator controls — not part of BoT's API.
    if (parts[0] === '_sim') {
      if (method === 'GET' && parts[1] === 'state') return [200, this.state()];
      if (method === 'POST' && parts[1] === 'close') {
        const { isin, cutoffPrice } = parseJson(raw) as { isin?: string; cutoffPrice?: string };
        return [200, await this.closeAuction(String(isin), String(cutoffPrice))];
      }
      throw new SimError(404, 'NOT_FOUND', 'Unknown simulator control');
    }

    if (method === 'POST' && url.pathname === '/api/auth') {
      const participant = this.verifyRequest(req, method, pathAndQuery, raw);
      return [200, this.authenticate(participant, raw)];
    }

    const participant = this.verifyRequest(req, method, pathAndQuery, raw);
    this.requireToken(req, participant);

    if (method === 'GET' && url.pathname === '/auctions') return [200, this.listAuctions(url)];
    if (parts[0] === 'bids' && parts.length === 2 && method === 'POST') {
      return [201, this.submitBids(participant, parts[1] ?? '', raw)];
    }
    if (parts[0] === 'bids' && parts.length === 2 && method === 'GET') {
      return [200, this.listBids(participant, parts[1] ?? '', url)];
    }
    if (parts[0] === 'bids' && parts.length === 3 && method === 'PUT') {
      return [202, this.updateBid(participant, parts[1] ?? '', parts[2] ?? '', raw)];
    }
    if (parts[0] === 'winners' && parts.length === 2 && method === 'GET') {
      return [200, this.winners(parts[1] ?? '')];
    }
    throw new SimError(404, 'NOT_FOUND', `No route for ${method} ${url.pathname}`);
  }

  // ------------------------------------------------------------------ security

  /** Checks participant headers, API key, timestamp freshness and the RSA signature. */
  private verifyRequest(
    req: IncomingMessage,
    method: string,
    pathAndQuery: string,
    raw: string,
  ): SimParticipant {
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const sender = header('sender');
    const participant = this.options.participants.find((p) => p.senderCode === sender);
    if (
      !participant ||
      header('interface') !== participant.interfaceCode ||
      header('x-api-key') !== participant.apiKey
    ) {
      throw new SimError(
        401,
        'UNAUTHORIZED',
        'Invalid x-api-key or unverified interface/sender credential',
      );
    }
    const timestamp = header('x-timestamp');
    if (!timestamp || !isTimestampFresh(timestamp, this.now())) {
      throw new SimError(
        400,
        'TIMESTAMP_OUT_OF_TOLERANCE',
        'x-timestamp is missing or outside the 300-second window',
      );
    }
    const signature = header('x-signature') ?? '';
    const data = canonicalString({ method, pathAndQuery, timestamp, body: raw });
    if (!verifyBotSignature(participant.publicKeyPem, data, signature)) {
      throw new SimError(403, 'SIGNATURE_INVALID', 'RSA-SHA256 signature verification failed');
    }
    return participant;
  }

  private requireToken(req: IncomingMessage, participant: SimParticipant): void {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const session = token ? this.sessions.get(token) : undefined;
    if (scheme?.toLowerCase() !== 'bearer' || !session || session.participant !== participant) {
      throw new SimError(
        401,
        'UNAUTHORIZED',
        'Invalid or expired JWT token, or missing Authorization header',
      );
    }
    if (session.expiresAt <= this.now().getTime()) {
      this.sessions.delete(token ?? '');
      throw new SimError(
        401,
        'UNAUTHORIZED',
        'Invalid or expired JWT token, or missing Authorization header',
      );
    }
  }

  private authenticate(participant: SimParticipant, raw: string) {
    const { username } = parseJson(raw) as { username?: string };
    if (username !== participant.username) {
      throw new SimError(401, 'UNAUTHORIZED', 'Unknown username for this participant');
    }
    const accessToken = `sim.${randomBytes(24).toString('base64url')}`;
    this.sessions.set(accessToken, {
      participant,
      expiresAt: this.now().getTime() + this.tokenLifetime * 1000,
    });
    return {
      status: 'success',
      mode: 'simulator',
      accessToken,
      refreshToken: `sim-refresh.${randomBytes(24).toString('base64url')}`,
      expiresIn: this.tokenLifetime,
      tokenType: 'Bearer',
      issuedAt: botTimestamp(this.now()),
    };
  }

  // ------------------------------------------------------------------ endpoints

  private listAuctions(url: URL) {
    const q = url.searchParams;
    const limit = Number(q.get('limit') ?? 20);
    const page = Number(q.get('page') ?? 1);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(page) ||
      page < 1
    ) {
      throw new SimError(400, 'INVALID_QUERY', 'page must be ≥ 1 and limit 1–100');
    }
    const from = q.get('fromDate');
    const to = q.get('toDate');
    if (from && to && to < from)
      throw new SimError(400, 'INVALID_QUERY', 'toDate must be on or after fromDate');
    return this.auctions
      .filter((a) => !q.get('ISIN') || a.ISIN === q.get('ISIN'))
      .filter((a) => !q.get('instrumentType') || a.instrumentType === q.get('instrumentType'))
      .filter((a) => !from || a.auctionDate >= from)
      .filter((a) => !to || a.auctionDate <= to)
      .slice((page - 1) * limit, page * limit)
      .map(({ cutoffAt: _cutoff, ...item }) => item);
  }

  private submitBids(participant: SimParticipant, batchReference: string, raw: string) {
    if (!isValidBatchReference(batchReference)) {
      throw new SimError(
        400,
        'INVALID_BATCH_REFERENCE',
        'Batch reference must be 8 alphanumeric characters, YYMMDD and a 3-digit sequence',
      );
    }
    if (parseBatchReference(batchReference)?.participantCode !== participant.participantCode) {
      throw new SimError(
        400,
        'INVALID_BATCH_REFERENCE',
        'Batch reference does not carry your participant code',
      );
    }
    if (this.batches.has(batchReference)) {
      throw new SimError(
        409,
        'DUPLICATE_BATCH_REFERENCE',
        `Batch ${batchReference} has already been submitted`,
      );
    }
    const packages = parseJson(raw);
    if (!Array.isArray(packages) || packages.length === 0) {
      throw new SimError(400, 'VALIDATION_ERROR', 'Body must be a non-empty array of bid packages');
    }

    // Validate everything before storing anything: a batch is accepted whole or not at all.
    const accepted: SimBid[] = [];
    for (const pkg of packages as { ISIN?: unknown; bids?: unknown }[]) {
      const auction = this.auctions.find((a) => a.ISIN === pkg.ISIN);
      if (!auction)
        throw new SimError(404, 'AUCTION_NOT_FOUND', `Auction ISIN ${String(pkg.ISIN)} not found`);
      if (auction.status !== 'OPEN' || auction.cutoffAt.getTime() <= this.now().getTime()) {
        throw new SimError(
          409,
          'AUCTION_CUTOFF_EXCEEDED',
          `Auction for ISIN ${auction.ISIN} closed at ${auction.cutoffAt.toISOString().replace(/\.\d{3}Z$/, 'Z')}. Bids can no longer be accepted.`,
        );
      }
      if (!Array.isArray(pkg.bids) || pkg.bids.length === 0) {
        throw new SimError(400, 'VALIDATION_ERROR', `No bids for ISIN ${auction.ISIN}`);
      }
      for (const bid of pkg.bids as Record<string, unknown>[]) {
        accepted.push(this.validateBid(participant, batchReference, auction.ISIN, bid));
      }
    }

    this.batches.add(batchReference);
    for (const bid of accepted) {
      this.bids.push(bid);
      // The dealer desk verifies straight away in the simulator.
      bid.action = 'accepted';
      bid.remarks = 'Bid verified by dealer desk';
      this.callback(
        bid,
        { status: 'accepted', action: 'accepted' },
        `Bid ${bid.requestId} accepted`,
      );
    }
    return {
      status: 'success',
      batchReference,
      submittedBidsCount: accepted.length,
      totalAmount: accepted.reduce((sum, b) => sum + b.amount, 0),
      message: 'Batch bids submitted successfully to CDS',
      timestamp: botTimestamp(this.now()),
    };
  }

  private validateBid(
    participant: SimParticipant,
    batchReference: string,
    isin: string,
    bid: Record<string, unknown>,
  ): SimBid {
    const { securityAccount, amount, competitive, price } = bid;
    if (typeof securityAccount !== 'string' || securityAccount.trim() === '') {
      throw new SimError(400, 'VALIDATION_ERROR', 'securityAccount is required');
    }
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
      throw new SimError(400, 'VALIDATION_ERROR', 'amount must be a whole number');
    }
    if (BigInt(amount) < BOT_MIN_BID_TZS) {
      throw new SimError(
        400,
        'BID_BELOW_MINIMUM',
        `Bid amount less than ${BOT_MIN_BID_TZS} threshold`,
      );
    }
    if (competitive !== 'Y' && competitive !== 'N') {
      throw new SimError(400, 'VALIDATION_ERROR', "competitive must be 'Y' or 'N'");
    }
    if (typeof price !== 'string' || !PRICE.test(price)) {
      throw new SimError(
        400,
        'INVALID_PRICE',
        'price must be a decimal string with at most two decimals',
      );
    }
    const now = botTimestamp(this.now());
    return {
      requestId: randomUUID(),
      batchReference,
      participant: participant.username,
      ISIN: isin,
      securityAccount,
      amount,
      priceHundredths: toHundredths(price),
      competitive,
      action: 'initiated',
      remarks: 'Bid registered and queued for auction processing',
      receivedAt: now,
    };
  }

  private listBids(participant: SimParticipant, isin: string, url: URL) {
    const q = url.searchParams;
    const limit = Number(q.get('limit') ?? 20);
    const page = Number(q.get('page') ?? 1);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(page) ||
      page < 1
    ) {
      throw new SimError(400, 'INVALID_QUERY', 'page must be ≥ 1 and limit 1–100');
    }
    return this.bids
      .filter((b) => b.ISIN === isin && b.participant === participant.username)
      .filter((b) => !q.get('requestId') || b.requestId === q.get('requestId'))
      .filter((b) => !q.get('batchReference') || b.batchReference === q.get('batchReference'))
      .filter((b) => !q.get('securityAccount') || b.securityAccount === q.get('securityAccount'))
      .filter((b) => !q.get('action') || b.action === q.get('action'))
      .filter((b) => !q.get('competitive') || b.competitive === q.get('competitive'))
      .slice((page - 1) * limit, page * limit)
      .map((b) => ({
        ISIN: b.ISIN,
        investor: participant.displayName,
        securityAccount: b.securityAccount,
        amount: b.amount,
        // Responses carry the price as a JSON number, requests as a string (B12).
        price: b.priceHundredths / 100,
        competitive: b.competitive,
        action: b.action,
        remarks: b.remarks,
        requestId: b.requestId,
        batchReference: b.batchReference,
        receivedAt: b.receivedAt,
        createdAt: b.receivedAt,
      }));
  }

  private updateBid(participant: SimParticipant, isin: string, reference: string, raw: string) {
    const bid = this.bids.find(
      (b) => b.ISIN === isin && b.requestId === reference && b.participant === participant.username,
    );
    if (!bid) throw new SimError(400, 'BID_NOT_FOUND', 'Bid reference not found');
    const auction = this.auctions.find((a) => a.ISIN === isin);
    if (
      !auction ||
      auction.status !== 'OPEN' ||
      auction.cutoffAt.getTime() <= this.now().getTime()
    ) {
      throw new SimError(
        409,
        'AUCTION_CUTOFF_EXCEEDED',
        'Auction closed; the bid can no longer be updated',
      );
    }
    const update = parseJson(raw) as { amount?: unknown; competitive?: unknown; price?: unknown };
    if (typeof update.price !== 'string' || !PRICE.test(update.price)) {
      throw new SimError(
        400,
        'INVALID_PRICE',
        'price is required, as a decimal string with at most two decimals',
      );
    }
    if (update.amount !== undefined) {
      if (
        typeof update.amount !== 'number' ||
        !Number.isSafeInteger(update.amount) ||
        BigInt(update.amount) < BOT_MIN_BID_TZS
      ) {
        throw new SimError(
          400,
          'BID_BELOW_MINIMUM',
          `Bid amount less than ${BOT_MIN_BID_TZS} threshold`,
        );
      }
      bid.amount = update.amount;
    }
    if (update.competitive === 'Y' || update.competitive === 'N')
      bid.competitive = update.competitive;
    bid.priceHundredths = toHundredths(update.price);
    return {
      status: 'success',
      reference: bid.requestId,
      action: 'updated',
      message: 'Bid updated successfully prior to cutoff',
      timestamp: botTimestamp(this.now()),
    };
  }

  /** Faithful to the spec: winners carry no securityAccount or requestId (B1). */
  private winners(isin: string) {
    const auction = this.auctions.find((a) => a.ISIN === isin);
    if (!auction) throw new SimError(404, 'AUCTION_NOT_FOUND', `Auction ISIN ${isin} not found`);
    const displayName = (username: string) =>
      this.options.participants.find((p) => p.username === username)?.displayName ?? username;
    const winners =
      auction.status === 'CLOSED'
        ? this.bids
            .filter((b) => b.ISIN === isin && (b.allottedAmount ?? 0) > 0)
            .map((b) => ({
              investor: displayName(b.participant),
              amount: b.allottedAmount,
              price: (b.allottedPriceHundredths ?? 0) / 100,
              competitive: b.competitive,
            }))
        : [];
    return {
      [isin]: {
        ISIN: isin,
        securityName: auction.securityName,
        auctionDate: auction.auctionDate,
        winners,
        hasMore: false,
        total: winners.length,
      },
    };
  }

  // ------------------------------------------------------------------ callbacks

  /** Posts a signed callback to the bid's participant, tracked so `settle()` can wait for it. */
  private callback(bid: SimBid, data: Record<string, unknown>, message: string): void {
    const participant = this.options.participants.find((p) => p.username === bid.participant);
    if (!participant?.callbackUrl) return;
    const url = participant.callbackUrl;
    const body = JSON.stringify({
      data: {
        ISIN: bid.ISIN,
        requestId: bid.requestId,
        batchReference: bid.batchReference,
        ...data,
      },
      message,
    });
    const delivery: SimCallbackDelivery = { url, body, status: null };
    this.callbacks.push(delivery);

    const task = (async () => {
      const target = new URL(url);
      const timestamp = botTimestamp(this.now());
      const signature = await this.signer.sign(
        canonicalString({
          method: 'POST',
          pathAndQuery: `${target.pathname}${target.search}`,
          timestamp,
          body,
        }),
      );
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-timestamp': timestamp,
            'x-signature': signature,
          },
          body,
        });
        delivery.status = response.status;
      } catch (error) {
        delivery.error = error instanceof Error ? error.message : String(error);
        this.log(`callback to ${url} failed: ${delivery.error}`);
      }
    })();
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private state() {
    return {
      auctions: this.auctions.map((a) => ({ ...a, cutoffAt: a.cutoffAt.toISOString() })),
      bids: this.bids.length,
      batches: [...this.batches],
      callbacks: this.callbacks.map(({ url, status, error }) => ({ url, status, error })),
      participants: this.options.participants.map((p) => p.username),
    };
  }
}

// ---------------------------------------------------------------- helpers

function toHundredths(price: string): number {
  const [whole = '0', fraction = ''] = price.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function parseJson(raw: string): unknown {
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new SimError(400, 'MALFORMED_BODY', 'Request body is not valid JSON');
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
