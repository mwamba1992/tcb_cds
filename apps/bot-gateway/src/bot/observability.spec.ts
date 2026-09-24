import { generateKeyPairSync } from 'node:crypto';
import { PemRequestSigner } from '@govsec/bot-client';
import { BotSimulator } from '@govsec/bot-simulator';
import { BotApiClient } from './bot-api.client';
import { BotHealth, SKEW_WARNING_SECONDS } from './bot-health';
import {
  batchReferenceFrom,
  observers,
  skewFromDateHeader,
  type BotExchange,
} from './bot-observer';
import { BotTokenManager } from './bot-token.manager';
import { BotTransport } from './bot-transport';
import { BotService } from './bot.service';

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const tcb = pair();
const bot = pair();

const exchange = (overrides: Partial<BotExchange> = {}): BotExchange => ({
  at: new Date(),
  method: 'GET',
  path: '/auctions',
  status: 200,
  durationMs: 12,
  errorCode: null,
  batchReference: null,
  clockSkewSeconds: 0,
  ...overrides,
});

describe('exchange helpers', () => {
  it('finds the batch reference in a submission path, and only there', () => {
    expect(batchReferenceFrom('/bids/TCBGSP01-260925-001')).toBe('TCBGSP01-260925-001');
    expect(batchReferenceFrom('/bids/TZ1996104321')).toBeNull();
    expect(batchReferenceFrom('/auctions')).toBeNull();
  });

  it('measures BoT’s clock against ours from the Date header', () => {
    const received = new Date('2026-09-24T08:00:00Z');
    expect(skewFromDateHeader('Thu, 24 Sep 2026 08:01:30 GMT', received)).toBe(90);
    expect(skewFromDateHeader('Thu, 24 Sep 2026 07:59:00 GMT', received)).toBe(-60);
    expect(skewFromDateHeader(null, received)).toBeNull();
    expect(skewFromDateHeader('not a date', received)).toBeNull();
  });

  it('keeps calling the other observers when one throws', () => {
    const seen: BotExchange[] = [];
    const fan = observers(
      {
        onExchange: () => {
          throw new Error('broken observer');
        },
      },
      { onExchange: (e) => seen.push(e) },
    );
    expect(() => fan.onExchange(exchange())).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

describe('BotHealth', () => {
  it('reports reachable, and counts failures until BoT answers again', () => {
    const health = new BotHealth();
    health.setConfigured(true);
    health.onExchange(exchange());
    expect(health.snapshot()).toMatchObject({
      configured: true,
      reachable: true,
      consecutiveFailures: 0,
    });

    health.onExchange(exchange({ status: 0, errorCode: 'NETWORK_ERROR' }));
    health.onExchange(exchange({ status: 503, errorCode: 'HTTP_503' }));
    expect(health.snapshot()).toMatchObject({
      reachable: false,
      consecutiveFailures: 2,
      lastFailure: { status: 503, code: 'HTTP_503' },
    });

    health.onExchange(exchange());
    expect(health.snapshot()).toMatchObject({ reachable: true, consecutiveFailures: 0 });
  });

  it('treats a 4xx as BoT answering: the link is up even if the request was refused', () => {
    const health = new BotHealth();
    health.onExchange(exchange({ status: 409, errorCode: 'AUCTION_CUTOFF_EXCEEDED' }));
    expect(health.snapshot().reachable).toBe(true);
  });

  it('flags clock drift well inside BoT’s 300-second limit', () => {
    const health = new BotHealth();
    health.onExchange(exchange({ clockSkewSeconds: SKEW_WARNING_SECONDS - 1 }));
    expect(health.snapshot().clockOk).toBe(true);
    health.onExchange(exchange({ clockSkewSeconds: -SKEW_WARNING_SECONDS }));
    expect(health.snapshot()).toMatchObject({
      clockOk: false,
      clockSkewSeconds: -SKEW_WARNING_SECONDS,
    });
  });
});

describe('transport reporting against the simulator', () => {
  let sim: BotSimulator;
  let baseUrl: string;
  const seen: BotExchange[] = [];

  beforeAll(async () => {
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
    baseUrl = await sim.start();
  });

  afterAll(async () => {
    await sim.stop();
  });

  function service(fetchImpl?: typeof fetch) {
    const transport = new BotTransport(
      {
        baseUrl,
        apiKey: 'sim-api-key',
        interfaceCode: 'BOT-I-GSS-099',
        senderCode: 'TCB_TZ',
        username: 'TCB',
      },
      new PemRequestSigner(tcb.privateKey),
      { observer: { onExchange: (e) => seen.push(e) }, ...(fetchImpl ? { fetchImpl } : {}) },
    );
    return new BotService(
      new BotApiClient(transport, new BotTokenManager(transport), { baseDelayMs: 1 }),
    );
  }

  beforeEach(() => {
    seen.length = 0;
  });

  it('reports every exchange: sign-in, calls, status and timing', async () => {
    await service().listAuctions();
    expect(seen.map((e) => [e.method, e.path, e.status])).toEqual([
      ['POST', '/api/auth', 200],
      ['GET', '/auctions', 200],
    ]);
    expect(seen.every((e) => e.durationMs >= 0 && e.clockSkewSeconds !== null)).toBe(true);
  });

  it('records the batch reference and BoT’s error code on a refusal', async () => {
    const small = [
      {
        isin: 'TZ1996104321',
        bids: [
          {
            securityAccount: 'CDS-SECRET-1',
            faceValue: '1000000',
            competitive: true,
            price: '88.00',
          },
        ],
      },
    ];
    const ref = `TCBGSP01-${sim.auctions[0]?.auctionDate.slice(2).replace(/-/g, '')}-009`;
    await service().submitBatch(ref, small);
    await service().submitBatch(ref, small); // duplicate → 409
    const refused = seen.find((e) => e.status === 409);
    expect(refused).toMatchObject({ batchReference: ref, errorCode: 'DUPLICATE_BATCH_REFERENCE' });
  });

  it('never carries bodies, credentials or account filters', async () => {
    await service().getBids('TZ1996104321', { securityAccount: 'CDS-SECRET-1' });
    const text = JSON.stringify(seen);
    expect(text).not.toContain('CDS-SECRET-1');
    expect(text).not.toContain('sim-api-key');
    expect(text).not.toContain('securityAccount');
  });

  it('detects a skewed BoT clock from its Date header', async () => {
    const ahead = new Date(Date.now() + 120_000).toUTCString();
    const skewed: typeof fetch = async (input, init) => {
      const real = await fetch(input, init);
      const headers = new Headers(real.headers);
      headers.set('date', ahead);
      return new Response(await real.text(), { status: real.status, headers });
    };
    await service(skewed).listAuctions();
    const skew = seen.at(-1)?.clockSkewSeconds ?? 0;
    expect(skew).toBeGreaterThanOrEqual(119);
    expect(skew).toBeLessThanOrEqual(121);
  });

  it('reports an unreachable BoT with status 0', async () => {
    const down: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    await expect(service(down).listAuctions()).rejects.toMatchObject({ status: 0 });
    expect(seen.every((e) => e.status === 0 && e.errorCode === 'NETWORK_ERROR')).toBe(true);
  });
});
