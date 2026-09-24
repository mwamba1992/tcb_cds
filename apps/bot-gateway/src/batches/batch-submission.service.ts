import { BOT_EVENTS, type BotBatchSubmittedPayload } from '@govsec/events';
import type { BatchSubmission, BotService, OutgoingPackage } from '../bot/bot.service';

/**
 * Sends a batch to BoT on the auction service's behalf, and records that it did.
 *
 * The batch reference is BoT's idempotency key, and it is ours too: asking twice for
 * the same reference returns the recorded result without calling BoT again. That makes
 * the auction service free to retry after a timeout without any risk of a second
 * submission — which BoT would refuse with 409 anyway, but only after a round trip.
 */

export interface SubmissionRecord extends BatchSubmission {
  requestedBy: string;
}

export interface SubmissionStore {
  find(batchReference: string): Promise<SubmissionRecord | null>;
  /** Saves the record and its bot.batch.submitted event together. */
  save(record: SubmissionRecord, event: BotBatchSubmittedPayload): Promise<void>;
}

export class BatchSubmissionService {
  constructor(
    private readonly bot: BotService,
    private readonly store: SubmissionStore,
  ) {}

  async submit(
    batchReference: string,
    packages: OutgoingPackage[],
    requestedBy: string,
  ): Promise<{ submission: SubmissionRecord; replayed: boolean }> {
    const existing = await this.store.find(batchReference);
    if (existing) return { submission: existing, replayed: true };

    const result = await this.bot.submitBatch(batchReference, packages);
    const record: SubmissionRecord = { ...result, requestedBy };
    await this.store.save(record, {
      batchReference: record.batchReference,
      bidsSubmitted: record.bidsSubmitted,
      totalFaceValue: record.totalFaceValue,
      alreadySubmitted: record.alreadySubmitted,
      requestedBy,
    });
    return { submission: record, replayed: false };
  }
}

export const BATCH_EVENT = BOT_EVENTS.batchSubmitted;
