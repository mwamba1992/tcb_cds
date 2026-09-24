import { generateKeyPairSync } from 'node:crypto';
import { PemRequestSigner } from '@govsec/bot-client';
import type { BotBatchReconciledPayload, BotWinnersCheckedPayload } from '@govsec/events';
import { BotSimulator } from '@govsec/bot-simulator';
import { BotApiClient } from '../bot/bot-api.client';
import { BotTokenManager } from '../bot/bot-token.manager';
import { BotTransport } from '../bot/bot-transport';
import { BotService, type OutgoingPackage } from '../bot/bot.service';
import {
  SubmissionReconciler,
  matchBatch,
  type PendingBatch,
  type ReconcileStore,
} from './submission-reconciler';
import { WinnersCheck, type WinnersCandidate, type WinnersStore } from './winners-check';

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const tcb = pair();
const bot = pair();

const view = (
  isin: string,
  securityAccount: string,
  faceValue: string,
  requestId: string,
  status = 'accepted',
) => ({
  isin,
  requestId,
  batchReference: 'B',
  securityAccount,
  faceValue,
  price: '88.5',
  competitive: true,
  status,
  remarks: null,
  receivedAt: null,
});
const sent = (securityAccount: string, faceValue: string) => ({
  isin: 'TZ1',
  securityAccount,
  faceValue,
  competitive: true,
  price: '88.50',
});

describe('matchBatch', () => {
  it('matches every sent bid to one BoT bid and carries BoT’s requestId', () => {
    const result = matchBatch(
      'B',
      [sent('A', '1000000'), sent('B', '2000000')],
      [view('TZ1', 'B', '2000000.00', 'r-b'), view('TZ1', 'A', '1000000.00', 'r-a')],
    );
    expect(result.status).toBe('matched');
    expect(result.bids.map((b) => [b.securityAccount, b.requestId])).toEqual([
      ['A', 'r-a'],
      ['B', 'r-b'],
    ]);
  });

  it('matches identical bids one to one, so a lost duplicate is still found', () => {
    const result = matchBatch(
      'B',
      [sent('A', '1000000'), sent('A', '1000000')],
      [view('TZ1', 'A', '1000000.00', 'r-1')],
    );
    expect(result.status).toBe('breaks');
    expect(result.missing).toHaveLength(1);
  });

  it('reports bids BoT holds that we did not send', () => {
    const result = matchBatch(
      'B',
      [sent('A', '1000000')],
      [view('TZ1', 'A', '1000000.00', 'r-1'), view('TZ1', 'Z', '5000000.00', 'r-2')],
    );
    expect(result.unexpected).toEqual([
      { isin: 'TZ1', requestId: 'r-2', securityAccount: 'Z', faceValue: '5000000.00' },
    ]);
  });

  it('treats a bid BoT rejected as a break even though it was found', () => {
    const result = matchBatch(
      'B',
      [sent('A', '1000000')],
      [view('TZ1', 'A', '1000000.00', 'r-1', 'rejected')],
    );
    expect(result.status).toBe('breaks');
    expect(result.rejected).toHaveLength(1);
  });

  it('does not match a bid whose face value differs', () => {
    const result = matchBatch('B', [sent('A', '1000000')], [view('TZ1', 'A', '1500000.00', 'r-1')]);
    expect(result.missing).toHaveLength(1);
    expect(result.unexpected).toHaveLength(1);
  });
});

class MemoryReconcileStore implements ReconcileStore {
  readonly results: BotBatchReconciledPayload[] = [];
  constructor(private readonly batches: PendingBatch[]) {}
  async pending() {
    return this.batches;
  }
  async saveResult(_ref: string, result: BotBatchReconciledPayload) {
    this.results.push(result);
    return true;
  }
  async recordAmendment() {
    return undefined;
  }
}

class MemoryWinnersStore implements WinnersStore {
  readonly saved: BotWinnersCheckedPayload[] = [];
  constructor(private readonly list: WinnersCandidate[]) {}
  async candidates() {
    return this.list;
  }
  async save(result: BotWinnersCheckedPayload) {
    this.saved.push(result);
    return true;
  }
}

describe('reconciliation against the simulator', () => {
  let sim: BotSimulator;
  let service: BotService;
  let reference: string;

  const packages: OutgoingPackage[] = [
    {
      isin: 'TZ1996104321',
      bids: [
        { securityAccount: 'CDS-A', faceValue: '10000000', competitive: true, price: '89.00' },
        { securityAccount: 'CDS-B', faceValue: '3000000', competitive: true, price: '87.00' },
        { securityAccount: 'CDS-C', faceValue: '2000000', competitive: false, price: null },
      ],
    },
  ];

  beforeEach(async () => {
    sim = new BotSimulator({
      participants: [
        {
          displayName: 'TANZANIA COMMERCIAL BANK',
          username: 'TCB',
          senderCode: 'TCB_TZ',
          interfaceCode: 'BOT-I-GSS-099',
          apiKey: 'sim-api-key',
          publicKeyPem: tcb.publicKey,
          participantCode: 'TCBGSP01',
        },
      ],
      botPrivateKeyPem: bot.privateKey,
    });
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
    service = new BotService(
      new BotApiClient(transport, new BotTokenManager(transport), { baseDelayMs: 1 }),
    );
    reference = `TCBGSP01-${sim.auctions[0]?.auctionDate.slice(2).replace(/-/g, '')}-001`;
    await service.submitBatch(reference, packages);
  });

  afterEach(async () => {
    await sim.stop();
  });

  const reconcile = async () => {
    const store = new MemoryReconcileStore([{ batchReference: reference, packages, attempts: 0 }]);
    const [result] = (await new SubmissionReconciler(service, store).runOnce()) ?? [];
    return result;
  };

  it('confirms BoT holds every bid, with the requestId for each', async () => {
    const result = await reconcile();
    expect(result?.status).toBe('matched');
    const held = new Map(sim.bids.map((b) => [b.securityAccount, b.requestId]));
    for (const bid of result?.bids ?? []) {
      expect(bid.requestId).toBe(held.get(bid.securityAccount));
    }
  });

  it('finds a bid that went missing at BoT', async () => {
    sim.bids.splice(
      sim.bids.findIndex((b) => b.securityAccount === 'CDS-B'),
      1,
    );
    const result = await reconcile();
    expect(result?.status).toBe('breaks');
    expect(result?.missing).toEqual([
      { isin: 'TZ1996104321', securityAccount: 'CDS-B', faceValue: '3000000.00' },
    ]);
  });

  it('finds a bid BoT rejected after accepting the batch', async () => {
    const bid = sim.bids.find((b) => b.securityAccount === 'CDS-A');
    if (bid) bid.action = 'rejected';
    const result = await reconcile();
    expect(result?.rejected.map((b) => b.securityAccount)).toEqual(['CDS-A']);
  });

  it('reads past the first page of a large batch', async () => {
    const first = sim.bids[0];
    if (!first) throw new Error('no bid');
    // Pretend BoT holds 150 more bids under our reference than we sent.
    for (let i = 0; i < 150; i += 1) {
      sim.bids.push({ ...first, requestId: `extra-${i}`, securityAccount: `CDS-X${i}` });
    }
    const result = await reconcile();
    expect(result?.bids).toHaveLength(3);
    expect(result?.unexpected).toHaveLength(150);
  });

  describe('winners cross-check', () => {
    it('confirms the callback total against /winners', async () => {
      await sim.closeAuction('TZ1996104321', '88.00');
      // Allotted: CDS-A 10,000,000 and non-competitive CDS-C 2,000,000.
      const store = new MemoryWinnersStore([
        { isin: 'TZ1996104321', callbacksTotal: '12000000.00' },
      ]);
      const [result] =
        (await new WinnersCheck(service, store, 'Tanzania Commercial Bank').runOnce()) ?? [];
      expect(result).toEqual({
        changed: true,
        isin: 'TZ1996104321',
        status: 'matched',
        callbacksTotal: '12000000.00',
        winnersTotal: '12000000.00',
      });
    });

    it('raises a break when a callback was lost', async () => {
      await sim.closeAuction('TZ1996104321', '88.00');
      const store = new MemoryWinnersStore([
        { isin: 'TZ1996104321', callbacksTotal: '10000000.00' },
      ]);
      const [result] =
        (await new WinnersCheck(service, store, 'TANZANIA COMMERCIAL BANK').runOnce()) ?? [];
      expect(result).toMatchObject({ status: 'break', winnersTotal: '12000000.00' });
    });
  });
});
