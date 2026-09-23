import { generateKeyPairSync } from 'node:crypto';
import {
  PemRequestSigner,
  botTimestamp,
  canonicalString,
  isTimestampFresh,
  verifyBotSignature,
} from './signing';

describe('BoT request signing', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  describe('canonical string', () => {
    it('matches the example in spec §2.2 exactly', () => {
      expect(
        canonicalString({
          method: 'post',
          pathAndQuery: '/api/auth',
          timestamp: '2026-09-17T12:00:00Z',
          body: '{"username":"COM BANK"}',
        }),
      ).toBe('POST\n/api/auth\n2026-09-17T12:00:00Z\n{"username":"COM BANK"}');
    });

    it('ends with an empty line when there is no body', () => {
      // A GET still has four parts. Dropping the trailing separator produces a
      // different string and a signature BoT rejects.
      expect(
        canonicalString({ method: 'GET', pathAndQuery: '/auctions?page=1', timestamp: 'T' }),
      ).toBe('GET\n/auctions?page=1\nT\n');
    });
  });

  describe('signatures', () => {
    const data = canonicalString({
      method: 'POST',
      pathAndQuery: '/bids/CORPTZTZ-270726-001',
      timestamp: '2026-09-17T12:00:00Z',
      body: '[{"ISIN":"TZ1996106013","bids":[]}]',
    });

    it('produces a signature the matching public key verifies', async () => {
      const signature = await new PemRequestSigner(privateKey).sign(data);
      expect(verifyBotSignature(publicKey, data, signature)).toBe(true);
    });

    it('fails verification if one character of the body changes', async () => {
      const signature = await new PemRequestSigner(privateKey).sign(data);
      expect(verifyBotSignature(publicKey, data.replace('bids', 'Bids'), signature)).toBe(false);
    });

    it('returns false rather than throwing on garbage', () => {
      expect(verifyBotSignature(publicKey, data, 'not-base64!!')).toBe(false);
      expect(verifyBotSignature('not a key', data, 'AAAA')).toBe(false);
    });
  });

  describe('timestamps', () => {
    const now = new Date('2026-09-17T12:00:00.456Z');

    it('formats as ISO 8601 UTC without milliseconds', () => {
      expect(botTimestamp(now)).toBe('2026-09-17T12:00:00Z');
    });

    it('accepts a timestamp inside the 300-second window', () => {
      expect(isTimestampFresh('2026-09-17T11:56:00Z', now)).toBe(true);
    });

    it('rejects one outside it, in either direction', () => {
      expect(isTimestampFresh('2026-09-17T11:54:00Z', now)).toBe(false);
      expect(isTimestampFresh('2026-09-17T12:06:00Z', now)).toBe(false);
    });

    it('accepts epoch milliseconds, which the spec also allows', () => {
      expect(isTimestampFresh(String(now.getTime() - 1000), now)).toBe(true);
    });

    it('rejects nonsense', () => {
      expect(isTimestampFresh('yesterday', now)).toBe(false);
    });
  });
});
