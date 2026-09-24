import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  PemRequestSigner,
  botTimestamp,
  canonicalString,
  verifyBotSignature,
} from '@govsec/bot-client';
import { BotSimulator, type SimParticipant } from './simulator';

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const tcb = pair();
const bot = pair();

/** A minimal hand-rolled client, so the simulator is tested independently of bot-gateway. */
function client(baseUrl: string, participant: SimParticipant, privateKey = tcb.privateKey) {
  const signer = new PemRequestSigner(privateKey);
  let token = '';
  const call = async (
    method: string,
    pathAndQuery: string,
    body?: unknown,
    opts: { timestamp?: string } = {},
  ) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = opts.timestamp ?? botTimestamp();
    const signature = await signer.sign(
      canonicalString({ method, pathAndQuery, timestamp, body: raw }),
    );
    const response = await fetch(`${baseUrl}${pathAndQuery}`, {
      method,
      headers: {
        'content-type': 'application/json',
        interface: participant.interfaceCode,
        sender: participant.senderCode,
        'x-api-key': participant.apiKey,
        'x-timestamp': timestamp,
        'x-signature': signature,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: raw || undefined,
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown> & unknown[],
    };
  };
  return {
    call,
    async login() {
      const res = await call('POST', '/api/auth', { username: participant.username });
      token = String(res.body.accessToken);
      return res;
    },
  };
}

describe('BoT simulator', () => {
  let sim: BotSimulator;
  let baseUrl: string;
  let callbackServer: Server;
  const received: { headers: Record<string, string>; body: string; path: string }[] = [];
  let participant: SimParticipant;

  beforeAll(async () => {
    callbackServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({
          headers: req.headers as Record<string, string>,
          body,
          path: req.url ?? '',
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"acknowledged"}');
      });
    });
    await new Promise<void>((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
    const port = (callbackServer.address() as AddressInfo).port;

    participant = {
      displayName: 'TANZANIA COMMERCIAL BANK',
      username: 'TCB',
      senderCode: 'TCB_TZ',
      interfaceCode: 'BOT-I-GSS-099',
      apiKey: 'sim-api-key',
      publicKeyPem: tcb.publicKey,
      participantCode: 'TCBGSP01',
      callbackUrl: `http://127.0.0.1:${port}/bot/callback`,
    };
    sim = new BotSimulator({ participants: [participant], botPrivateKeyPem: bot.privateKey });
    baseUrl = await sim.start();
  });

  afterAll(async () => {
    await sim.stop();
    await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
  });

  const reference = (seq: number) => {
    const date = sim.auctions[0]?.auctionDate.slice(2).replace(/-/g, '') ?? '000000';
    return `TCBGSP01-${date}-${String(seq).padStart(3, '0')}`;
  };

  describe('authentication', () => {
    it('issues a 12-hour token for a correctly signed request', async () => {
      const res = await client(baseUrl, participant).login();
      expect(res.status).toBe(200);
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBe(43_200);
    });

    it('rejects a request signed with the wrong key', async () => {
      const res = await client(baseUrl, participant, pair().privateKey).call('POST', '/api/auth', {
        username: 'TCB',
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SIGNATURE_INVALID');
    });

    it('rejects a stale timestamp', async () => {
      const stale = botTimestamp(new Date(Date.now() - 10 * 60_000));
      const res = await client(baseUrl, participant).call(
        'POST',
        '/api/auth',
        { username: 'TCB' },
        { timestamp: stale },
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
    });

    it('rejects an unknown API key', async () => {
      const res = await client(baseUrl, { ...participant, apiKey: 'wrong' }).call(
        'POST',
        '/api/auth',
        { username: 'TCB' },
      );
      expect(res.status).toBe(401);
    });

    it('refuses API calls without a token', async () => {
      const res = await client(baseUrl, participant).call('GET', '/auctions');
      expect(res.status).toBe(401);
    });
  });

  describe('auctions', () => {
    it('lists auctions without a cut-off time, as the spec does (B4)', async () => {
      const c = client(baseUrl, participant);
      await c.login();
      const res = await c.call('GET', '/auctions?instrumentType=TBILLS');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).not.toHaveProperty('cutoffAt');
    });

    it('rejects a limit above 100', async () => {
      const c = client(baseUrl, participant);
      await c.login();
      expect((await c.call('GET', '/auctions?limit=500')).status).toBe(400);
    });
  });

  describe('bids and allotment', () => {
    it('accepts a batch, gives each bid a requestId, and refuses a duplicate reference', async () => {
      const c = client(baseUrl, participant);
      await c.login();
      const batch = [
        {
          ISIN: 'TZ1996104321',
          bids: [
            {
              securityAccount: 'CDS-TCB-0001',
              amount: 10_000_000,
              competitive: 'Y',
              price: '88.50',
            },
            {
              securityAccount: 'CDS-TCB-0002',
              amount: 2_000_000,
              competitive: 'Y',
              price: '87.00',
            },
            { securityAccount: 'CDS-TCB-0003', amount: 1_000_000, competitive: 'N', price: '0.00' },
          ],
        },
      ];
      const res = await c.call('POST', `/bids/${reference(1)}`, batch);
      expect(res.status).toBe(201);
      expect(res.body.submittedBidsCount).toBe(3);
      expect(res.body.totalAmount).toBe(13_000_000);

      const bids = await c.call('GET', `/bids/TZ1996104321?batchReference=${reference(1)}`);
      expect(bids.body).toHaveLength(3);
      expect(new Set((bids.body as { requestId: string }[]).map((b) => b.requestId)).size).toBe(3);

      const again = await c.call('POST', `/bids/${reference(1)}`, batch);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('DUPLICATE_BATCH_REFERENCE');
    });

    it('refuses a bid below TZS 500,000 and a malformed reference', async () => {
      const c = client(baseUrl, participant);
      await c.login();
      const small = [
        {
          ISIN: 'TZ1996104206',
          bids: [{ securityAccount: 'CDS-1', amount: 400_000, competitive: 'Y', price: '94.00' }],
        },
      ];
      expect((await c.call('POST', `/bids/${reference(2)}`, small)).body.code).toBe(
        'BID_BELOW_MINIMUM',
      );
      expect((await c.call('POST', '/bids/BADREF', small)).body.code).toBe(
        'INVALID_BATCH_REFERENCE',
      );
    });

    it('closes the auction, publishes winners without accounts, and sends signed callbacks', async () => {
      received.length = 0;
      const result = await sim.closeAuction('TZ1996104321', '88.00');
      expect(result).toEqual({ allotted: 2, unsuccessful: 1 });

      const c = client(baseUrl, participant);
      await c.login();
      const winners = await c.call('GET', '/winners/TZ1996104321');
      const entry = (winners.body as unknown as Record<string, { winners: object[] }>)[
        'TZ1996104321'
      ];
      expect(entry?.winners).toHaveLength(2);
      // Faithful to the spec: no way to tell whose allotment is whose (B1).
      expect(entry?.winners[0]).not.toHaveProperty('securityAccount');

      expect(received).toHaveLength(3);
      for (const callback of received) {
        const data = canonicalString({
          method: 'POST',
          pathAndQuery: callback.path,
          timestamp: callback.headers['x-timestamp'] ?? '',
          body: callback.body,
        });
        expect(verifyBotSignature(bot.publicKey, data, callback.headers['x-signature'] ?? '')).toBe(
          true,
        );
      }
      const statuses = received
        .map((r) => (JSON.parse(r.body) as { data: { status: string } }).data.status)
        .sort();
      expect(statuses).toEqual(['allotted', 'allotted', 'unsuccessful']);
    });

    it('refuses bids after the auction has closed', async () => {
      const c = client(baseUrl, participant);
      await c.login();
      const late = [
        {
          ISIN: 'TZ1996104321',
          bids: [{ securityAccount: 'CDS-9', amount: 1_000_000, competitive: 'Y', price: '90.00' }],
        },
      ];
      const res = await c.call('POST', `/bids/${reference(3)}`, late);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUCTION_CUTOFF_EXCEEDED');
    });
  });
});
