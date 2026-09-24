import { isValidBatchReference } from '@govsec/bot-client';

/**
 * One request–response exchange with BoT, as seen by the transport.
 *
 * Deliberately metadata only: no bodies, no headers, no query string. Bodies carry
 * investors' CDS accounts, headers carry the API key and signature, and query strings
 * can carry account filters. What remains is enough to answer an auditor's or BoT's
 * question — what did you send, when, and what came back — without copying personal
 * data or credentials into a log.
 */
export interface BotExchange {
  at: Date;
  method: string;
  /** Path only, e.g. /bids/TCBGSP01-260925-001. */
  path: string;
  /** HTTP status, or 0 when BoT could not be reached. */
  status: number;
  durationMs: number;
  /** BoT's error code on failure. */
  errorCode: string | null;
  /** The batch reference in the path, when there is one. */
  batchReference: string | null;
  /** BoT's clock minus ours, in whole seconds, from its Date header; null if absent. */
  clockSkewSeconds: number | null;
}

export interface BotExchangeObserver {
  onExchange(exchange: BotExchange): void;
}

/** Fans one exchange out to several observers; one failing does not stop the rest. */
export function observers(...list: BotExchangeObserver[]): BotExchangeObserver {
  return {
    onExchange(exchange) {
      for (const observer of list) {
        try {
          observer.onExchange(exchange);
        } catch {
          // An observer must never break a BoT call.
        }
      }
    },
  };
}

export function batchReferenceFrom(path: string): string | null {
  const segment = decodeURIComponent(path.split('/').filter(Boolean)[1] ?? '');
  return path.startsWith('/bids/') && isValidBatchReference(segment) ? segment : null;
}

/**
 * BoT's clock relative to ours, from the HTTP Date header (one-second resolution).
 * Measured against the moment the response arrived, which is when BoT stamped it.
 */
export function skewFromDateHeader(dateHeader: string | null, receivedAt: Date): number | null {
  if (!dateHeader) return null;
  const botTime = Date.parse(dateHeader);
  if (!Number.isFinite(botTime)) return null;
  return Math.round((botTime - receivedAt.getTime()) / 1000);
}
