import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PemRequestSigner, botTimestamp, canonicalString } from '@govsec/bot-client';
import { BOT_EVENTS } from '@govsec/events';
import { BotSimulator, type SimParticipant } from '@govsec/bot-simulator';
import {
  AuctionSyncService,
  type SnapshotChange,
  type SnapshotStore,
} from '../auctions/auction-sync.service';
import {
  BatchSubmissionService,
  type SubmissionRecord,
  type SubmissionStore,
} from '../batches/batch-submission.service';
import { BotApiClient } from '../bot/bot-api.client';
import { BotTokenManager } from '../bot/bot-token.manager';
import { BotTransport } from '../bot/bot-transport';
import { BotService, BotValidationError, type AuctionSummary } from '../bot/bot.service';
import {
  CallbackService,
  type CallbackEvent,
  type CallbackRecord,
  type CallbackStore,
} from './callback.service';

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const tcb = pair();
const bot = pair();

/** In-memory stand-ins for the Prisma stores, with the same once-only guarantee. */
class MemoryCallbackStore implements CallbackStore {
  readonly records: CallbackRecord[] = [];
  readonly events: CallbackEvent[] = [];
  async saveOnce(record: CallbackRecord, event: CallbackEvent) {
    if (this.records.some((r) => r.dedupeKey === record.dedupeKey)) return 'duplicate' as const;
    this.records.push(record);
    this.events.push(event);
    return 'stored' as const;
  }
}

class MemorySubmissionStore implements SubmissionStore {
  readonly rows = new Map<string, SubmissionRecord>();
  readonly events: unknown[] = [];
  async find(ref: string) {
    return this.rows.get(ref) ?? null;
  }
  async save(record: SubmissionRecord, event: unknown) {
    this.rows.set(record.batchReference, record);
    this.events.push(event);
  }
}

class MemorySnapshotStore implements SnapshotStore {
  readonly snapshots = new Map<string, string>();
  readonly changes: SnapshotChange[] = [];
  async hashes(isins: string[]) {
    return new Map(
      isins.filter((i) => this.snapshots.has(i)).map((i) => [i, this.snapshots.get(i) ?? '']),
    );
  }
  async apply(changes: SnapshotChange[]) {
    for (const change of changes) this.snapshots.set(change.isin, change.hash);
    this.changes.push(...changes);
  }
}

describe('callbacks, batches and auction sync', () => {
  let sim: BotSimulator;
  let receiver: Server;
  let callbacks: CallbackService;
  let inbox: MemoryCallbackStore;
  let botService: BotService;
  let callbackPath: string;
  const responses: number[] = [];

  beforeEach(async () => {
    inbox = new MemoryCallbackStore();
    callbacks = new CallbackService(inbox, bot.publicKey);
    responses.length = 0;

    // A stand-in for CallbackController: raw body and headers straight into the service.
    receiver = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', async () => {
        const outcome = await callbacks.receive({
          pathAndQuery: req.url ?? '',
          rawBody: raw,
          timestamp: req.headers['x-timestamp'] as string | undefined,
          signature: req.headers['x-signature'] as string | undefined,
        });
        const status = outcome.kind === 'rejected' ? outcome.status : 200;
        responses.push(status);
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    callbackPath = '/bot/callback';
    const participant: SimParticipant = {
      displayName: 'TANZANIA COMMERCIAL BANK',
      username: 'TCB',
      senderCode: 'TCB_TZ',
      interfaceCode: 'BOT-I-GSS-099',
      apiKey: 'sim-api-key',
      publicKeyPem: tcb.publicKey,
      participantCode: 'TCBGSP01',
      callbackUrl: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}${callbackPath}`,
    };
    sim = new BotSimulator({ participants: [participant], botPrivateKeyPem: bot.privateKey });
    const baseUrl = await sim.start();
    const transport = new BotTransport(
      {
        baseUrl,
        apiKey: 'sim-api-key',
        interfaceCode: 'BOT-I-GSS-099',
        senderCode: 'TCB_TZ',
        username: 'TCB',
      },
      new PemRequestSigner(tcb.privateKey),
    );
    botService = new BotService(
      new BotApiClient(transport, new BotTokenManager(transport), { baseDelayMs: 1 }),
    );
  });

  afterEach(async () => {
    await sim.stop();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });

  const reference = (seq: number) => {
    const date = sim.auctions[0]?.auctionDate.slice(2).replace(/-/g, '') ?? '000000';
    return `TCBGSP01-${date}-${String(seq).padStart(3, '0')}`;
  };

  /** Signs a callback exactly as BoT would, for the tampering cases. */
  async function signedCallback(body: string, key = bot.privateKey, timestamp = botTimestamp()) {
    const signature = await new PemRequestSigner(key).sign(
      canonicalString({ method: 'POST', pathAndQuery: callbackPath, timestamp, body }),
    );
    return { pathAndQuery: callbackPath, rawBody: body, timestamp, signature };
  }

  describe('full cycle', () => {
    it('matches every allotment back to our bids by requestId, which /winners cannot do', async () => {
      await botService.submitBatch(reference(1), [
        {
          isin: 'TZ1996104321',
          bids: [
            { securityAccount: 'CDS-A', faceValue: '10000000', competitive: true, price: '89.00' },
            { securityAccount: 'CDS-B', faceValue: '3000000', competitive: true, price: '87.00' },
            { securityAccount: 'CDS-C', faceValue: '2000000', competitive: false, price: null },
          ],
        },
      ]);
      await sim.closeAuction('TZ1996104321', '88.00');

      const ours = await botService.getBids('TZ1996104321', { batchReference: reference(1) });
      const outcomes = inbox.events.filter((e) => e.eventType !== BOT_EVENTS.bidAccepted);
      expect(outcomes).toHaveLength(3);
      expect(responses.every((status) => status === 200)).toBe(true);

      for (const bid of ours) {
        const outcome = outcomes.find((e) => e.payload.requestId === bid.requestId);
        expect(outcome).toBeDefined();
        if (bid.securityAccount === 'CDS-B') {
          expect(outcome?.eventType).toBe(BOT_EVENTS.bidUnsuccessful);
        } else {
          expect(outcome?.eventType).toBe(BOT_EVENTS.bidAllotted);
          expect(outcome?.payload.allottedFaceValue).toBe(bid.faceValue);
        }
      }
      // The non-competitive bid was allotted at the weighted average price, as a string.
      const nonComp = ours.find((b) => b.securityAccount === 'CDS-C');
      expect(
        outcomes.find((e) => e.payload.requestId === nonComp?.requestId)?.payload.allottedPrice,
      ).toBe('89');
    });

    it('records acceptance callbacks as bot.bid.accepted when the batch lands', async () => {
      await botService.submitBatch(reference(2), [
        {
          isin: 'TZ1996104206',
          bids: [
            { securityAccount: 'CDS-A', faceValue: '1000000', competitive: true, price: '94.00' },
          ],
        },
      ]);
      await sim.settle();
      expect(inbox.events.map((e) => e.eventType)).toEqual([BOT_EVENTS.bidAccepted]);
    });
  });

  describe('callback security', () => {
    const body = JSON.stringify({
      data: {
        requestId: 'r-1',
        status: 'allotted',
        allottedAmount: 5_000_000,
        allottedPrice: 99.1,
      },
      message: 'ok',
    });

    it('stores a validly signed callback once, and acknowledges a redelivery without reprocessing', async () => {
      const first = await callbacks.receive(await signedCallback(body));
      const again = await callbacks.receive(await signedCallback(body));
      expect(first).toEqual({ kind: 'stored', event: BOT_EVENTS.bidAllotted });
      expect(again).toEqual({ kind: 'duplicate' });
      expect(inbox.events).toHaveLength(1);
      expect(inbox.events[0]?.payload).toMatchObject({
        allottedFaceValue: '5000000.00',
        allottedPrice: '99.1',
      });
    });

    it('rejects a callback whose body was altered after signing', async () => {
      const signed = await signedCallback(body);
      const tampered = { ...signed, rawBody: body.replace('5000000', '9000000') };
      expect(await callbacks.receive(tampered)).toMatchObject({
        kind: 'rejected',
        status: 401,
        code: 'SIGNATURE_INVALID',
      });
      expect(inbox.records).toHaveLength(0);
    });

    it('rejects a callback signed by anyone but BoT', async () => {
      expect(await callbacks.receive(await signedCallback(body, pair().privateKey))).toMatchObject({
        status: 401,
      });
    });

    it('rejects a replayed callback outside the timestamp window', async () => {
      const stale = botTimestamp(new Date(Date.now() - 10 * 60_000));
      expect(
        await callbacks.receive(await signedCallback(body, bot.privateKey, stale)),
      ).toMatchObject({
        status: 401,
        code: 'STALE_TIMESTAMP',
      });
    });

    it('rejects a signed callback missing its data or message', async () => {
      expect(await callbacks.receive(await signedCallback('{"message":"x"}'))).toMatchObject({
        status: 400,
      });
    });

    it('keeps a callback with an unknown status, flagged for investigation (B6)', async () => {
      const odd = JSON.stringify({
        data: { requestId: 'r-2', status: 'suspended' },
        message: 'odd',
      });
      expect(await callbacks.receive(await signedCallback(odd))).toEqual({
        kind: 'stored',
        event: BOT_EVENTS.callbackUnrecognised,
      });
    });

    it('refuses every callback when BoT’s key is not configured', async () => {
      const unconfigured = new CallbackService(inbox, null);
      expect(await unconfigured.receive(await signedCallback(body))).toMatchObject({ status: 503 });
    });
  });

  describe('batch submission service', () => {
    const packages = [
      {
        isin: 'TZ1996104321',
        bids: [
          { securityAccount: 'CDS-A', faceValue: '1000000', competitive: true, price: '88.00' },
        ],
      },
    ];

    it('submits once, records it with its event, and replays without calling BoT again', async () => {
      const store = new MemorySubmissionStore();
      const service = new BatchSubmissionService(botService, store);
      const first = await service.submit(reference(3), packages, 'auction');
      const second = await service.submit(reference(3), packages, 'auction');
      expect(first.replayed).toBe(false);
      expect(second).toEqual({ submission: first.submission, replayed: true });
      expect(store.events).toEqual([
        {
          batchReference: reference(3),
          bidsSubmitted: 1,
          totalFaceValue: '1000000.00',
          alreadySubmitted: false,
          requestedBy: 'auction',
        },
      ]);
      expect(sim.bids).toHaveLength(1);
    });

    it('records nothing when the batch is refused', async () => {
      const store = new MemorySubmissionStore();
      const service = new BatchSubmissionService(botService, store);
      const small = [
        {
          isin: 'TZ1996104321',
          bids: [
            { securityAccount: 'CDS-A', faceValue: '1000', competitive: true, price: '88.00' },
          ],
        },
      ];
      await expect(service.submit(reference(4), small, 'auction')).rejects.toBeInstanceOf(
        BotValidationError,
      );
      expect(store.rows.size).toBe(0);
    });
  });

  describe('auction sync', () => {
    it('publishes new auctions once, stays quiet when nothing changes, and reports changes', async () => {
      const store = new MemorySnapshotStore();
      const sync = new AuctionSyncService(botService, store);

      expect(await sync.syncOnce()).toEqual({ seen: 3, published: 3, updated: 0 });
      expect(await sync.syncOnce()).toEqual({ seen: 3, published: 0, updated: 0 });

      await sim.closeAuction('TZ1996104206', '94.00');
      expect(await sync.syncOnce()).toEqual({ seen: 3, published: 0, updated: 1 });
      const change = store.changes.at(-1);
      expect(change).toMatchObject({ kind: 'updated', isin: 'TZ1996104206' });
      expect((change?.auction as AuctionSummary).status).toBe('closed');
    });

    it('skips a sync that starts while another is running', async () => {
      const sync = new AuctionSyncService(botService, new MemorySnapshotStore());
      const [first, second] = await Promise.all([sync.syncOnce(), sync.syncOnce()]);
      expect([first, second].filter((r) => r === null)).toHaveLength(1);
    });
  });
});
