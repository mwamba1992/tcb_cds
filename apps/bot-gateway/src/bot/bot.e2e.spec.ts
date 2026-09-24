import { generateKeyPairSync } from 'node:crypto';
import { PemRequestSigner } from '@govsec/bot-client';
import { BotSimulator, type SimParticipant } from '@govsec/bot-simulator';
import { BotApiClient } from './bot-api.client';
import { BotTokenManager } from './bot-token.manager';
import { BotApiError, BotTransport, type BotCredentials } from './bot-transport';
import { BotService, BotValidationError, NON_COMPETITIVE_PRICE } from './bot.service';

/**
 * bot-gateway's BoT client against the BoT simulator, end to end: real HTTP, real
 * RSA signatures, real tokens. When BoT issues sandbox credentials the same client
 * points at proxy-sandbox.bot.go.tz with no code change.
 */

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const tcb = pair();
const bot = pair();

const PARTICIPANT: SimParticipant = {
  displayName: 'TANZANIA COMMERCIAL BANK',
  username: 'TCB',
  senderCode: 'TCB_TZ',
  interfaceCode: 'BOT-I-GSS-099',
  apiKey: 'sim-api-key',
  publicKeyPem: tcb.publicKey,
  participantCode: 'TCBGSP01',
};

describe('BoT client against the simulator', () => {
  let sim: BotSimulator;
  let baseUrl: string;
  let authCalls: number;
  let failNext: number[];

  /** Counts sign-ins and can fail the next N calls with a status, to exercise recovery. */
  const fetchSpy: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth') authCalls += 1;
    const forced = failNext.shift();
    if (forced) return new Response('{"code":"UPSTREAM","message":"forced"}', { status: forced });
    return fetch(input, init);
  };

  function service(overrides: Partial<BotCredentials> = {}, privateKey = tcb.privateKey) {
    const transport = new BotTransport(
      {
        baseUrl,
        apiKey: PARTICIPANT.apiKey,
        interfaceCode: PARTICIPANT.interfaceCode,
        senderCode: PARTICIPANT.senderCode,
        username: PARTICIPANT.username,
        ...overrides,
      },
      new PemRequestSigner(privateKey),
      { fetchImpl: fetchSpy },
    );
    const client = new BotApiClient(transport, new BotTokenManager(transport), {
      baseDelayMs: 1,
    });
    return new BotService(client);
  }

  const reference = (seq: number) => {
    const date = sim.auctions[0]?.auctionDate.slice(2).replace(/-/g, '') ?? '000000';
    return `TCBGSP01-${date}-${String(seq).padStart(3, '0')}`;
  };

  beforeEach(async () => {
    authCalls = 0;
    failNext = [];
    sim = new BotSimulator({ participants: [PARTICIPANT], botPrivateKeyPem: bot.privateKey });
    baseUrl = await sim.start();
  });

  afterEach(async () => {
    await sim.stop();
  });

  describe('auctions', () => {
    it('lists auctions in our vocabulary, with money as decimal strings', async () => {
      const auctions = await service().listAuctions({ instrumentType: 'TBILLS' });
      expect(auctions).toHaveLength(2);
      expect(auctions[0]).toMatchObject({
        isin: 'TZ1996104321',
        instrument: 'bill',
        status: 'open',
        competitiveOffer: '110000000000.00',
      });
    });
  });

  describe('batch submission', () => {
    const batch = [
      {
        isin: 'TZ1996104321',
        bids: [
          {
            securityAccount: 'CDS-TCB-0048213',
            faceValue: '10000000',
            competitive: true,
            price: '88.5',
          },
          {
            securityAccount: 'CDS-TCB-0039920',
            faceValue: '2000000',
            competitive: false,
            price: null,
          },
        ],
      },
    ];

    it('submits a batch and reads back each bid with its BoT requestId', async () => {
      const bot = service();
      const result = await bot.submitBatch(reference(1), batch);
      expect(result).toEqual({
        batchReference: reference(1),
        bidsSubmitted: 2,
        totalFaceValue: '12000000.00',
        alreadySubmitted: false,
      });

      const bids = await bot.getBids('TZ1996104321', { batchReference: reference(1) });
      expect(bids).toHaveLength(2);
      const competitive = bids.find((b) => b.competitive);
      expect(competitive).toMatchObject({
        faceValue: '10000000.00',
        price: '88.5',
        status: 'accepted',
      });
      expect(competitive?.requestId).toMatch(/[0-9a-f-]{36}/);
      // Pending BoT's answer to B5, a non-competitive bid carries the placeholder price.
      expect(bids.find((b) => !b.competitive)?.price).toBe(String(Number(NON_COMPETITIVE_PRICE)));
    });

    it('treats a repeated batch reference as already submitted, not as a failure', async () => {
      const bot = service();
      await bot.submitBatch(reference(2), batch);
      const again = await bot.submitBatch(reference(2), batch);
      expect(again.alreadySubmitted).toBe(true);
      expect(sim.bids.filter((b) => b.batchReference === reference(2))).toHaveLength(2);
    });

    it('refuses a bid below TZS 500,000 before it is signed or sent', async () => {
      const small = [
        {
          isin: 'TZ1996104321',
          bids: [{ securityAccount: 'CDS-1', faceValue: '400000', competitive: true, price: '90' }],
        },
      ];
      await expect(service().submitBatch(reference(3), small)).rejects.toBeInstanceOf(
        BotValidationError,
      );
      expect(sim.bids).toHaveLength(0);
    });

    it('refuses a price that would need rounding', async () => {
      const odd = [
        {
          isin: 'TZ1996104321',
          bids: [
            { securityAccount: 'CDS-1', faceValue: '1000000', competitive: true, price: '88.555' },
          ],
        },
      ];
      await expect(service().submitBatch(reference(4), odd)).rejects.toThrow(/rounding/);
    });

    it("surfaces BoT's cut-off refusal with its own code", async () => {
      await sim.closeAuction('TZ1996104321', '88.00');
      const error = await service()
        .submitBatch(reference(5), batch)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BotApiError);
      expect(error).toMatchObject({
        status: 409,
        code: 'AUCTION_CUTOFF_EXCEEDED',
        retryable: false,
      });
    });

    it('amends a bid before cut-off', async () => {
      const bot = service();
      await bot.submitBatch(reference(6), batch);
      const [first] = await bot.getBids('TZ1996104321', {
        batchReference: reference(6),
        competitive: 'Y',
      });
      await bot.updateBid('TZ1996104321', first?.requestId ?? '', {
        price: '89.25',
        faceValue: '12000000',
      });
      const [after] = await bot.getBids('TZ1996104321', { requestId: first?.requestId });
      expect(after).toMatchObject({ price: '89.25', faceValue: '12000000.00' });
    });
  });

  describe('winners', () => {
    it('reads winners after the auction closes, knowing they carry no account (B1)', async () => {
      const bot = service();
      await bot.submitBatch(reference(7), [
        {
          isin: 'TZ1996104321',
          bids: [
            { securityAccount: 'CDS-A', faceValue: '5000000', competitive: true, price: '89.00' },
            { securityAccount: 'CDS-B', faceValue: '3000000', competitive: true, price: '87.00' },
          ],
        },
      ]);
      await sim.closeAuction('TZ1996104321', '88.00');
      const result = await bot.getWinners('TZ1996104321');
      expect(result.winners).toEqual([
        {
          investor: 'TANZANIA COMMERCIAL BANK',
          faceValue: '5000000.00',
          price: '89',
          competitive: true,
        },
      ]);
    });
  });

  describe('authentication and recovery', () => {
    it('signs in once and reuses the token', async () => {
      const bot = service();
      await bot.listAuctions();
      await bot.listAuctions();
      expect(authCalls).toBe(1);
    });

    it('shares one sign-in between concurrent requests', async () => {
      const bot = service();
      await Promise.all([bot.listAuctions(), bot.listAuctions(), bot.listAuctions()]);
      expect(authCalls).toBe(1);
    });

    it('signs in again when BoT rejects an expired token', async () => {
      const bot = service();
      await bot.listAuctions();
      sim.expireTokens();
      await expect(bot.listAuctions()).resolves.toHaveLength(3);
      expect(authCalls).toBe(2);
    });

    it('retries when BoT fails on its side, then succeeds', async () => {
      const bot = service();
      await bot.listAuctions();
      failNext = [503, 502];
      await expect(bot.listAuctions()).resolves.toHaveLength(3);
    });

    it('gives up after the retry budget', async () => {
      const bot = service();
      await bot.listAuctions();
      failNext = [503, 503, 503];
      await expect(bot.listAuctions()).rejects.toMatchObject({ status: 503, retryable: true });
    });

    it('does not retry a signature failure', async () => {
      const error = await service({}, pair().privateKey)
        .listAuctions()
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 403, code: 'SIGNATURE_INVALID' });
      expect(authCalls).toBe(1);
    });

    it('reports an unreachable BoT as retryable network failure', async () => {
      await sim.stop();
      const error = await service()
        .listAuctions()
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR', retryable: true });
      baseUrl = await sim.start();
    });
  });
});
