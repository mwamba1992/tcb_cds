import { createSign, createVerify } from 'node:crypto';
import { BOT_TIMESTAMP_TOLERANCE_SECONDS } from './constants';

/**
 * Request signing for the BoT GSS API (spec §2.2, TAD §7.3).
 *
 * Every request carries `x-signature`: Base64 of an RSA-SHA256 (PKCS#1 v1.5) signature
 * over the canonical string
 *
 *     METHOD \n PATH_AND_QUERY \n TIMESTAMP \n BODY
 *
 * Two rules decide whether BoT accepts it, and both are easy to break:
 *
 *  1. **Sign the bytes you send.** The body is serialised once, signed, and that same
 *     string is written to the socket. Serialising twice — once to sign, once for the
 *     HTTP client — can reorder keys or change whitespace and the signature no longer
 *     matches.
 *  2. **Path and query, not path alone.** The spec's text says PATH_AND_QUERY; its
 *     Python sample signs the path only (Appendix B, B10). We follow the text until the
 *     sandbox says otherwise, and the choice is isolated here.
 */

export interface CanonicalRequest {
  method: string;
  /** Path plus query string exactly as sent, e.g. `/auctions?page=1&limit=20`. */
  pathAndQuery: string;
  /** The exact `x-timestamp` header value. */
  timestamp: string;
  /** The exact body string sent, or undefined for a request with no body. */
  body?: string;
}

export function canonicalString(request: CanonicalRequest): string {
  return [
    request.method.toUpperCase(),
    request.pathAndQuery,
    request.timestamp,
    request.body ?? '',
  ].join('\n');
}

/**
 * Something that can produce an RSA-SHA256 signature.
 *
 * An interface because production signs inside the HSM, where the private key never
 * leaves the device (TAD §10.1). Development and the sandbox use PemRequestSigner.
 */
export interface RequestSigner {
  /** Returns the Base64 signature of `data`. */
  sign(data: string): Promise<string>;
}

/** Signs with a PEM private key held in process memory. Not for production. */
export class PemRequestSigner implements RequestSigner {
  constructor(private readonly privateKeyPem: string) {}

  async sign(data: string): Promise<string> {
    const signer = createSign('RSA-SHA256');
    signer.update(data, 'utf8');
    signer.end();
    return signer.sign(this.privateKeyPem, 'base64');
  }
}

/**
 * Verifies a signature BoT placed on a callback, against BoT's public key.
 *
 * Returns false rather than throwing on a malformed signature: the caller answers 401
 * either way, and an exception path is one more way to leak which part was wrong.
 */
export function verifyBotSignature(
  publicKeyPem: string,
  data: string,
  signatureBase64: string,
): boolean {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(data, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

/**
 * The `x-timestamp` value for a request made at `now`.
 *
 * ISO 8601 in UTC without milliseconds, as every example in the spec shows. The spec
 * also allows epoch milliseconds (B10); one format everywhere means one canonical
 * string to debug.
 */
export function botTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Whether a timestamp is inside BoT's replay window of `now`.
 *
 * Used on inbound callbacks. Future timestamps are held to the same tolerance: a clock
 * that runs ahead is as much a sign of replay or misconfiguration as one that runs behind.
 */
export function isTimestampFresh(
  timestamp: string,
  now: Date = new Date(),
  toleranceSeconds = BOT_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  const parsed = /^\d+$/.test(timestamp) ? Number(timestamp) : Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(now.getTime() - parsed) <= toleranceSeconds * 1000;
}
