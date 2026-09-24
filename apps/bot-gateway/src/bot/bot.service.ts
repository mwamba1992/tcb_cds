import { Money } from '@govsec/money';
import {
  BOT_MIN_BID_TZS,
  BOT_PATHS,
  botAmountToMoney,
  botPriceToString,
  isValidBatchReference,
  moneyToBotAmount,
  toBotPrice,
  type BotAuctionItem,
  type BotAuctionQuery,
  type BotBidPackage,
  type BotBidQuery,
  type BotBidRecord,
  type BotWinner,
  type BotWinnersForIsin,
} from '@govsec/bot-client';
import type { BotApiClient } from './bot-api.client';
import { BotApiError } from './bot-transport';

/**
 * The BoT GSS API in the platform's own vocabulary (TAD §7.3).
 *
 * Everything that leaves this class is ours: ISINs and references as strings, money as
 * decimal strings from `Money`, booleans instead of 'Y'/'N'. BoT's JSON numbers are
 * converted at this line and nowhere else (Appendix B, B12).
 *
 * Rules BoT enforces are also checked here first, so a bad batch is refused with a
 * precise reason before it is signed and sent, rather than as a 400 at cut-off time.
 */

export interface AuctionSummary {
  isin: string;
  name: string;
  instrument: 'bill' | 'bond';
  auctionDate: string | null;
  maturityDate: string | null;
  competitiveOffer: string;
  nonCompetitiveOffer: string;
  status: 'open' | 'closed' | 'unknown';
}

export interface OutgoingBid {
  /** The investor's CDS security account. */
  securityAccount: string;
  /** Face value, whole shillings, as a decimal string. */
  faceValue: string;
  competitive: boolean;
  /** Price per 100; null for a non-competitive bid. */
  price: string | null;
}

export interface OutgoingPackage {
  isin: string;
  bids: OutgoingBid[];
}

export interface BatchSubmission {
  batchReference: string;
  bidsSubmitted: number;
  totalFaceValue: string;
  /**
   * BoT already had this batch reference (409). The earlier attempt reached BoT even
   * though its response did not reach us; reconcile with `getBids` rather than retry.
   */
  alreadySubmitted: boolean;
}

export interface BotBidView {
  requestId: string;
  batchReference: string;
  securityAccount: string | null;
  faceValue: string;
  price: string;
  competitive: boolean;
  status: string;
  remarks: string | null;
  receivedAt: string | null;
}

export interface WinnersView {
  isin: string;
  winners: {
    investor: string | null;
    faceValue: string;
    price: string | null;
    competitive: boolean;
  }[];
}

export class BotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotValidationError';
  }
}

/**
 * The price sent for a non-competitive bid. The spec requires a price on every bid but
 * does not say what a non-competitive one should carry (Appendix B, B5). Zero is the
 * placeholder until BoT answers; it is one constant so the answer is a one-line change.
 */
export const NON_COMPETITIVE_PRICE = '0.00';

export class BotService {
  constructor(private readonly api: BotApiClient) {}

  async listAuctions(query: BotAuctionQuery = {}): Promise<AuctionSummary[]> {
    const body = await this.api.call({
      method: 'GET',
      path: BOT_PATHS.auctions,
      query: { ...query },
    });
    return asArray<BotAuctionItem>(body).map(toAuctionSummary);
  }

  async submitBatch(batchReference: string, packages: OutgoingPackage[]): Promise<BatchSubmission> {
    if (!isValidBatchReference(batchReference)) {
      throw new BotValidationError(`Invalid batch reference "${batchReference}"`);
    }
    if (packages.length === 0 || packages.some((p) => p.bids.length === 0)) {
      throw new BotValidationError('A batch needs at least one ISIN, each with at least one bid');
    }
    let total = Money.zero('TZS');
    const wire: BotBidPackage[] = packages.map((pkg) => ({
      ISIN: pkg.isin,
      bids: pkg.bids.map((bid) => {
        const face = Money.parse(bid.faceValue, 'TZS');
        if (face.lessThan(Money.fromMinor(BOT_MIN_BID_TZS * 100n, 'TZS'))) {
          throw new BotValidationError(
            `Bid for ${bid.securityAccount} on ${pkg.isin} is below the TZS ${BOT_MIN_BID_TZS} minimum`,
          );
        }
        if (bid.competitive && bid.price === null) {
          throw new BotValidationError(`Competitive bid for ${bid.securityAccount} has no price`);
        }
        total = total.add(face);
        return {
          securityAccount: bid.securityAccount,
          amount: moneyToBotAmount(face),
          competitive: bid.competitive ? ('Y' as const) : ('N' as const),
          price: bid.competitive ? toBotPrice(bid.price ?? '') : NON_COMPETITIVE_PRICE,
        };
      }),
    }));

    try {
      const body = (await this.api.call({
        method: 'POST',
        path: BOT_PATHS.bids(batchReference),
        body: wire,
      })) as { submittedBidsCount?: unknown } | null;
      const count =
        typeof body?.submittedBidsCount === 'number'
          ? body.submittedBidsCount
          : wire.flatMap((p) => p.bids).length;
      return {
        batchReference,
        bidsSubmitted: count,
        totalFaceValue: total.toString(),
        alreadySubmitted: false,
      };
    } catch (error) {
      if (
        error instanceof BotApiError &&
        error.status === 409 &&
        error.code === 'DUPLICATE_BATCH_REFERENCE'
      ) {
        return {
          batchReference,
          bidsSubmitted: wire.flatMap((p) => p.bids).length,
          totalFaceValue: total.toString(),
          alreadySubmitted: true,
        };
      }
      throw error;
    }
  }

  async getBids(isin: string, query: BotBidQuery = {}): Promise<BotBidView[]> {
    const body = await this.api.call({
      method: 'GET',
      path: BOT_PATHS.bidsByIsin(isin),
      query: { ...query },
    });
    // The schema says { data: { bids } }; the samples return a bare array (B8).
    const records = Array.isArray(body)
      ? (body as BotBidRecord[])
      : asArray<BotBidRecord>((body as { data?: { bids?: unknown } } | null)?.data?.bids ?? body);
    return records.map((r) => ({
      requestId: r.requestId,
      batchReference: r.batchReference,
      securityAccount: r.securityAccount ?? null,
      faceValue: botAmountToMoney(r.amount).toString(),
      price: botPriceToString(r.price),
      competitive: r.competitive === 'Y',
      status: String(r.action),
      remarks: r.remarks ?? null,
      receivedAt: r.receivedAt ?? null,
    }));
  }

  async updateBid(
    isin: string,
    requestId: string,
    update: { faceValue?: string; competitive?: boolean; price: string },
  ): Promise<void> {
    const body: Record<string, unknown> = { price: toBotPrice(update.price) };
    if (update.faceValue !== undefined)
      body['amount'] = moneyToBotAmount(Money.parse(update.faceValue, 'TZS'));
    if (update.competitive !== undefined) body['competitive'] = update.competitive ? 'Y' : 'N';
    await this.api.call({ method: 'PUT', path: BOT_PATHS.bid(isin, requestId), body });
  }

  /**
   * Winners for an ISIN. BoT's winners carry no account or requestId (B1), so this is
   * for totals and cross-checks only; allotments are matched to investors from the
   * callbacks, which do carry the requestId.
   */
  async getWinners(isin: string): Promise<WinnersView> {
    const body = await this.api.call({ method: 'GET', path: BOT_PATHS.winners(isin) });
    const entry = findWinnersEntry(body, isin);
    return {
      isin,
      winners: (entry?.winners ?? []).map((w: BotWinner) => ({
        investor: w.investor ?? null,
        faceValue: botAmountToMoney(w.amount ?? 0).toString(),
        price: w.price === undefined ? null : botPriceToString(w.price),
        competitive: w.competitive === 'Y',
      })),
    };
  }
}

// ---------------------------------------------------------------- shape handling

function asArray<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/** The spec's samples key winners by ISIN; its schema wraps them in `data` (B8). */
function findWinnersEntry(body: unknown, isin: string): BotWinnersForIsin | undefined {
  const root = (body as { data?: unknown } | null)?.data ?? body;
  if (!root || typeof root !== 'object') return undefined;
  const keyed = (root as Record<string, BotWinnersForIsin>)[isin];
  if (keyed) return keyed;
  const direct = root as BotWinnersForIsin;
  return Array.isArray(direct.winners) ? direct : undefined;
}

function toAuctionSummary(item: BotAuctionItem): AuctionSummary {
  return {
    isin: item.ISIN ?? '',
    name: item.securityName ?? '',
    instrument: item.instrumentType === 'TBONDS' ? 'bond' : 'bill',
    auctionDate: item.auctionDate ?? null,
    maturityDate: item.maturityDate ?? null,
    competitiveOffer: botAmountToMoney(item.tenderedSizeCompetitive ?? 0).toString(),
    nonCompetitiveOffer: botAmountToMoney(item.tenderedSizeNonCompetitive ?? 0).toString(),
    status: item.status === 'OPEN' ? 'open' : item.status === 'CLOSED' ? 'closed' : 'unknown',
  };
}
