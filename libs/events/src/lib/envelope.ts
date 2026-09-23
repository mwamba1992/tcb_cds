/**
 * The envelope every GovSec domain event travels in.
 *
 * `idempotencyKey` is the field that makes at-least-once delivery safe (TAD §7.5):
 * consumers upsert against it, so a redelivery cannot double-apply an effect.
 *
 * `sequence` is the field that makes *ordering* safe, which idempotency alone does
 * not. Kafka gave per-partition ordering for free; RabbitMQ gives FIFO only on a
 * single-consumer queue. A consumer that cares about order — bid state transitions
 * above all — compares this against the last sequence it applied for the same
 * aggregate and parks anything that arrives early.
 */
export interface EventEnvelope<TPayload = unknown> {
  /** Unique per emission. A retry of the same publish reuses it. */
  eventId: string;
  /** Routing key, e.g. "identity.account.created". */
  eventType: string;
  /** Schema version of `payload`, so consumers can tolerate producer evolution. */
  version: number;
  /** Kind of entity this concerns, e.g. "investor", "bid", "funds_hold". */
  aggregateType: string;
  /** The entity's id. Also the partition key wherever ordering matters. */
  aggregateId: string;
  /** Monotonic per aggregate. See the ordering note above. */
  sequence: number;
  /** Deduplication key consumers upsert against (TAD §7.5). */
  idempotencyKey: string;
  /** When the state change happened, not when it was published. */
  occurredAt: string;
  /** Ties an event back to the request that caused it, across service hops. */
  correlationId?: string;
  payload: TPayload;
}

export function buildIdempotencyKey(
  eventType: string,
  aggregateId: string,
  sequence: number,
): string {
  return `${eventType}:${aggregateId}:${sequence}`;
}
