import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { buildIdempotencyKey, type EventEnvelope } from '@govsec/events';
import {
  OUTBOX_OPTIONS,
  OUTBOX_STORE,
  type OutboxRelayOptions,
  type OutboxRecord,
  type OutboxStore,
} from './outbox.types';

/**
 * Publishes committed outbox rows to RabbitMQ (TAD §7.5).
 *
 * The TAD describes a Kafka outbox relay. RabbitMQ has no equivalent, so
 * the relay polls instead — which is simpler, and just as correct, because the
 * guarantee comes from the row being written in the same transaction as the state
 * change, not from how it is later read.
 *
 * Ordering: rows are claimed by ascending id, which is per-aggregate emission order.
 * Delivery order across consumers is not guaranteed by RabbitMQ, so consumers that
 * care use the envelope's `sequence` field.
 *
 * Failure mode: publish-then-mark means a crash between the two republishes the row.
 * That is deliberate — at-least-once with an idempotency key is recoverable, whereas
 * mark-then-publish loses the event outright.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(OUTBOX_STORE) private readonly store: OutboxStore,
    @Inject(OUTBOX_OPTIONS) private readonly options: OutboxRelayOptions,
    private readonly amqp: AmqpConnection,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), this.options.pollIntervalMs);
    this.logger.log(
      `Outbox relay polling every ${this.options.pollIntervalMs}ms → ${this.options.exchange}`,
    );
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Drains pending rows. Public so tests can drive it without waiting on the timer. */
  async drain(): Promise<number> {
    // Skip rather than queue: a slow batch must not stack up overlapping drains.
    if (this.running || this.stopped) return 0;
    this.running = true;

    let published = 0;
    try {
      const batch = await this.store.claimBatch(this.options.batchSize);
      if (batch.length === 0) return 0;

      const sent: bigint[] = [];
      for (const record of batch) {
        try {
          await this.publish(record);
          sent.push(record.id);
          published += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to publish outbox row ${record.id} (${record.eventType}): ${message}`,
          );
          await this.store.markFailed(record.id, message);
          // Stop the batch here: publishing later rows while this one is stuck would
          // reorder events for the same aggregate.
          break;
        }
      }
      if (sent.length > 0) await this.store.markSent(sent);
    } catch (error) {
      this.logger.error(
        `Outbox drain failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
    return published;
  }

  private async publish(record: OutboxRecord): Promise<void> {
    const envelope: EventEnvelope = {
      eventId: `${record.aggregateType}-${record.id}`,
      eventType: record.eventType,
      version: 1,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      sequence: Number(record.id),
      idempotencyKey:
        record.idempotencyKey ||
        buildIdempotencyKey(record.eventType, record.aggregateId, Number(record.id)),
      occurredAt: record.occurredAt.toISOString(),
      payload: record.payload,
    };

    await this.amqp.publish(this.options.exchange, record.eventType, envelope, {
      // Survives a broker restart. Without it the durable exchange and quorum queue
      // are pointless — the message itself would still be held in memory only.
      persistent: true,
      messageId: envelope.eventId,
      timestamp: record.occurredAt.getTime(),
      contentType: 'application/json',
      headers: { 'x-idempotency-key': envelope.idempotencyKey },
    });
  }
}
