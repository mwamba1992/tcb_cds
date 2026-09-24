import { Injectable } from '@nestjs/common';
import type { BotBatchSubmittedPayload } from '@govsec/events';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import {
  BATCH_EVENT,
  type SubmissionRecord,
  type SubmissionStore,
} from './batch-submission.service';

@Injectable()
export class PrismaSubmissionStore implements SubmissionStore {
  constructor(private readonly prisma: PrismaService) {}

  async find(batchReference: string): Promise<SubmissionRecord | null> {
    const row = await this.prisma.batchSubmission.findUnique({ where: { batchReference } });
    if (!row) return null;
    return {
      batchReference: row.batchReference,
      bidsSubmitted: row.bidsSubmitted,
      // Decimal → string straight from Postgres NUMERIC; never through a float.
      totalFaceValue: row.totalFaceValue.toFixed(2),
      alreadySubmitted: row.alreadySubmitted,
      requestedBy: row.requestedBy,
    };
  }

  async save(record: SubmissionRecord, event: BotBatchSubmittedPayload): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.batchSubmission.create({
        data: {
          batchReference: record.batchReference,
          requestedBy: record.requestedBy,
          bidsSubmitted: record.bidsSubmitted,
          totalFaceValue: record.totalFaceValue,
          alreadySubmitted: record.alreadySubmitted,
        },
      }),
      this.prisma.outboxMessage.create({
        data: outboxRow({
          aggregateType: 'bot_batch',
          aggregateId: record.batchReference,
          eventType: BATCH_EVENT,
          payload: { ...event },
          dedupeKey: record.batchReference,
        }),
      }),
    ]);
  }
}
