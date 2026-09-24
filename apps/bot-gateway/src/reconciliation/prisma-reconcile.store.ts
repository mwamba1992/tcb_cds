import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { BOT_EVENTS, type BotBatchReconciledPayload } from '@govsec/events';
import type { Prisma } from '../generated/prisma/client';
import type { OutgoingPackage } from '../bot/bot.service';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import type { Amendment, PendingBatch, ReconcileStore } from './submission-reconciler';

/** How long after submission a batch keeps being checked, and how many times. */
const WINDOW_HOURS = 48;
const MAX_ATTEMPTS = 60;

@Injectable()
export class PrismaReconcileStore implements ReconcileStore {
  constructor(private readonly prisma: PrismaService) {}

  async pending(limit: number): Promise<PendingBatch[]> {
    const rows = await this.prisma.batchSubmission.findMany({
      where: {
        reconcileStatus: { in: ['pending', 'breaks'] },
        reconcileAttempts: { lt: MAX_ATTEMPTS },
        submittedAt: { gt: new Date(Date.now() - WINDOW_HOURS * 3_600_000) },
      },
      orderBy: { submittedAt: 'asc' },
      take: limit,
      select: { batchReference: true, packages: true, reconcileAttempts: true },
    });
    return rows.map((row) => ({
      batchReference: row.batchReference,
      packages: row.packages as unknown as OutgoingPackage[],
      attempts: row.reconcileAttempts,
    }));
  }

  /**
   * Saves the outcome and announces it. The event key includes the outcome's content,
   * so the same breaks found on every run are announced once, not every minute; a
   * change — a new break, or the batch coming right — is announced again.
   */
  async saveResult(batchReference: string, result: BotBatchReconciledPayload): Promise<boolean> {
    const breaks =
      result.status === 'breaks'
        ? { missing: result.missing, unexpected: result.unexpected, rejected: result.rejected }
        : null;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([result.status, breaks, result.bids.map((b) => b.requestId).sort()]))
      .digest('hex')
      .slice(0, 16);
    const [, inserted] = await this.prisma.$transaction([
      this.prisma.batchSubmission.update({
        where: { batchReference },
        data: {
          reconcileStatus: result.status,
          reconcileAttempts: { increment: 1 },
          reconciledAt: new Date(),
          breaks: (breaks ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
      this.prisma.outboxMessage.createMany({
        data: [
          outboxRow({
            aggregateType: 'bot_batch',
            aggregateId: batchReference,
            eventType: BOT_EVENTS.batchReconciled,
            payload: { ...result },
            dedupeKey: `${batchReference}:${fingerprint}`,
          }),
        ],
        skipDuplicates: true,
      }),
    ]);
    return inserted.count > 0;
  }

  /**
   * Applies an amendment to the record of what was sent, so reconciliation compares BoT
   * with what we now intend rather than flagging our own change as a break. The batch
   * goes back to pending to be checked again.
   */
  async recordAmendment(amendment: Amendment): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.batchSubmission.findUnique({
        where: { batchReference: amendment.batchReference },
        select: { packages: true },
      });
      if (!row) return;
      const packages = row.packages as unknown as OutgoingPackage[];
      const previous = amendment.previousFaceValue.replace(/\.00$/, '');
      const pkg = packages.find((p) => p.isin === amendment.isin);
      const bid = pkg?.bids.find(
        (b) =>
          b.securityAccount === amendment.securityAccount &&
          b.faceValue.replace(/\.00$/, '') === previous,
      );
      if (!bid) return;
      if (amendment.faceValue !== undefined) bid.faceValue = amendment.faceValue;
      if (amendment.competitive !== undefined) bid.competitive = amendment.competitive;
      bid.price = bid.competitive ? amendment.price : null;
      await tx.batchSubmission.update({
        where: { batchReference: amendment.batchReference },
        data: {
          packages: packages as unknown as Prisma.InputJsonValue,
          reconcileStatus: 'pending',
        },
      });
    });
  }
}
