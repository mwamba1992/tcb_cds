import { createHash } from 'node:crypto';
import {
  botAmountToMoney,
  botPriceToString,
  canonicalString,
  isTimestampFresh,
  verifyBotSignature,
} from '@govsec/bot-client';
import { BOT_EVENTS, type BotBidOutcomePayload, type BotEventType } from '@govsec/events';

/**
 * Receives BoT's webhook callbacks (spec §8, TAD §7.3).
 *
 * Three rules, in order:
 *
 *  1. **Verify before reading.** The RSA signature is checked against the raw bytes BoT
 *     sent, before any JSON parsing, and a stale x-timestamp is refused. Anything that
 *     fails is rejected without being stored — an unsigned "allotment" is not an
 *     allotment.
 *  2. **Store once.** BoT may redeliver. The dedupe key is a hash of the signed body, so
 *     the same event is recognised, acknowledged again, and not processed twice.
 *  3. **Acknowledge fast.** The callback and the event it produces are written in one
 *     transaction and BoT gets its 200. Everything downstream happens off the outbox,
 *     so a slow consumer can never make BoT time out and retry.
 */

export interface IncomingCallback {
  /** Path and query BoT posted to, as it signed it. */
  pathAndQuery: string;
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
}

export interface CallbackRecord {
  dedupeKey: string;
  requestId: string | null;
  batchReference: string | null;
  isin: string | null;
  status: string | null;
  message: string | null;
  payload: unknown;
}

export interface CallbackEvent {
  eventType: BotEventType;
  aggregateId: string;
  payload: BotBidOutcomePayload;
}

/** Storage for callbacks; implemented over Prisma in the service, in memory in tests. */
export interface CallbackStore {
  /** Saves the callback and its event together, or reports it was already there. */
  saveOnce(record: CallbackRecord, event: CallbackEvent): Promise<'stored' | 'duplicate'>;
}

export type CallbackOutcome =
  | { kind: 'stored'; event: BotEventType }
  | { kind: 'duplicate' }
  | { kind: 'rejected'; status: 400 | 401 | 503; code: string; message: string };

const STATUS_EVENTS: Record<string, BotEventType> = {
  accepted: BOT_EVENTS.bidAccepted,
  rejected: BOT_EVENTS.bidRejected,
  allotted: BOT_EVENTS.bidAllotted,
  unsuccessful: BOT_EVENTS.bidUnsuccessful,
};

export class CallbackService {
  constructor(
    private readonly store: CallbackStore,
    /** BoT's public key; null when not configured, in which case every callback is refused. */
    private readonly botPublicKeyPem: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async receive(callback: IncomingCallback): Promise<CallbackOutcome> {
    if (!this.botPublicKeyPem) {
      return {
        kind: 'rejected',
        status: 503,
        code: 'NOT_CONFIGURED',
        message: "BoT's public key is not configured",
      };
    }
    if (!callback.timestamp || !isTimestampFresh(callback.timestamp, this.now())) {
      return {
        kind: 'rejected',
        status: 401,
        code: 'STALE_TIMESTAMP',
        message: 'x-timestamp missing or outside the 300-second window',
      };
    }
    const signed = canonicalString({
      method: 'POST',
      pathAndQuery: callback.pathAndQuery,
      timestamp: callback.timestamp,
      body: callback.rawBody,
    });
    if (
      !callback.signature ||
      !verifyBotSignature(this.botPublicKeyPem, signed, callback.signature)
    ) {
      return {
        kind: 'rejected',
        status: 401,
        code: 'SIGNATURE_INVALID',
        message: 'Signature verification failed',
      };
    }

    let parsed: { data?: unknown; message?: unknown };
    try {
      parsed = JSON.parse(callback.rawBody) as typeof parsed;
    } catch {
      return {
        kind: 'rejected',
        status: 400,
        code: 'MALFORMED_BODY',
        message: 'Callback body is not valid JSON',
      };
    }
    if (
      !parsed ||
      typeof parsed.data !== 'object' ||
      parsed.data === null ||
      typeof parsed.message !== 'string'
    ) {
      return {
        kind: 'rejected',
        status: 400,
        code: 'MISSING_FIELDS',
        message: 'Callback needs a data object and a message',
      };
    }

    const data = parsed.data as Record<string, unknown>;
    const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : null);
    const status = text('status');
    const record: CallbackRecord = {
      dedupeKey: createHash('sha256').update(callback.rawBody).digest('hex'),
      requestId: text('requestId'),
      batchReference: text('batchReference'),
      isin: text('ISIN'),
      status,
      message: parsed.message,
      payload: parsed,
    };
    const eventType = (status && STATUS_EVENTS[status]) || BOT_EVENTS.callbackUnrecognised;
    const event: CallbackEvent = {
      eventType,
      aggregateId: record.requestId ?? record.batchReference ?? record.dedupeKey,
      payload: {
        requestId: record.requestId,
        batchReference: record.batchReference,
        isin: record.isin,
        botStatus: status,
        allottedFaceValue:
          eventType === BOT_EVENTS.bidAllotted ? amount(data['allottedAmount']) : null,
        allottedPrice: eventType === BOT_EVENTS.bidAllotted ? price(data['allottedPrice']) : null,
        message: record.message,
        receivedAt: this.now().toISOString(),
      },
    };

    const saved = await this.store.saveOnce(record, event);
    return saved === 'duplicate' ? { kind: 'duplicate' } : { kind: 'stored', event: eventType };
  }
}

/** BoT amounts are JSON numbers; convert at this line and nowhere else. */
function amount(value: unknown): string | null {
  try {
    return typeof value === 'number' ? botAmountToMoney(value).toString() : null;
  } catch {
    return null;
  }
}

function price(value: unknown): string | null {
  try {
    return typeof value === 'number' || typeof value === 'string' ? botPriceToString(value) : null;
  } catch {
    return null;
  }
}
