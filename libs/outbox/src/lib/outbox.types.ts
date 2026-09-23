import type { EventEnvelope, ExchangeName } from '@govsec/events';

export const OUTBOX_STORE = 'GOVSEC_OUTBOX_STORE';
export const OUTBOX_OPTIONS = 'GOVSEC_OUTBOX_OPTIONS';

export interface OutboxRecord {
  id: bigint;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  occurredAt: Date;
  attempts: number;
}

/**
 * The port each service implements over its own outbox table.
 *
 * It is a port rather than a shared Prisma model because every service owns its own
 * schema and generates its own client (TAD §9.2); a shared concrete implementation
 * would quietly reintroduce the cross-service coupling the database-per-service rule
 * exists to prevent.
 */
export interface OutboxStore {
  /**
   * Atomically claim up to `limit` unsent rows, oldest first.
   *
   * Implementations must use SELECT ... FOR UPDATE SKIP LOCKED so that running more
   * than one relay instance is safe — otherwise two replicas publish the same row.
   */
  claimBatch(limit: number): Promise<OutboxRecord[]>;
  markSent(ids: bigint[]): Promise<void>;
  markFailed(id: bigint, error: string): Promise<void>;
}

export interface OutboxRelayOptions {
  /** Exchange this service's events are published to. */
  exchange: ExchangeName;
  pollIntervalMs: number;
  batchSize: number;
}

export type OutboxEnvelope = EventEnvelope<unknown>;
