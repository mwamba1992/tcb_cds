import { Injectable } from '@nestjs/common';
import type { OutboxRecord, OutboxStore } from '@govsec/outbox';
import { PrismaService } from '../prisma/prisma.service';

interface Row {
  id: bigint;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  idempotency_key: string;
  occurred_at: Date;
  attempts: number;
}

/**
 * This service's outbox table, behind the shared relay's port.
 *
 * FOR UPDATE SKIP LOCKED makes running more than one replica safe: two relays never
 * claim the same row.
 */
@Injectable()
export class BotGatewayOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      UPDATE outbox_messages
         SET attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox_messages
          WHERE sent_at IS NULL
          ORDER BY id
            FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
       )
   RETURNING id, aggregate_type, aggregate_id, event_type, payload,
             idempotency_key, occurred_at, attempts
    `;
    return rows
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => ({
        id: row.id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        occurredAt: row.occurred_at,
        attempts: row.attempts,
      }));
  }

  async markSent(ids: bigint[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.outboxMessage.updateMany({
      where: { id: { in: ids } },
      data: { sentAt: new Date(), lastError: null },
    });
  }

  async markFailed(id: bigint, error: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { lastError: error.slice(0, 1000) },
    });
  }
}

/** Builds an outbox row. `dedupeKey` must be a stable business key, not a random id. */
export function outboxRow(input: {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}) {
  return {
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload as never,
    idempotencyKey: `${input.eventType}:${input.dedupeKey}`,
  };
}
