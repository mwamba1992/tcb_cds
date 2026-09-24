import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import type { CallbackEvent, CallbackRecord, CallbackStore } from './callback.service';

/**
 * The callback inbox and its outbox event, written in one transaction: either BoT's
 * callback is recorded and announced, or neither happens.
 */
@Injectable()
export class PrismaCallbackStore implements CallbackStore {
  constructor(private readonly prisma: PrismaService) {}

  async saveOnce(record: CallbackRecord, event: CallbackEvent): Promise<'stored' | 'duplicate'> {
    try {
      await this.prisma.$transaction([
        this.prisma.botCallback.create({
          data: { ...record, payload: record.payload as Prisma.InputJsonValue },
        }),
        this.prisma.outboxMessage.create({
          data: outboxRow({
            aggregateType: 'bot_bid',
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: { ...event.payload },
            dedupeKey: record.dedupeKey,
          }),
        }),
      ]);
      return 'stored';
    } catch (error) {
      // Unique violation on dedupe_key: BoT redelivered an event we already hold.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'duplicate';
      }
      throw error;
    }
  }
}
