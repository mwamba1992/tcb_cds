import type { BotBatchReconciledPayload, ReconciledBid } from '@govsec/events';
import type { BotBidView, BotService, OutgoingPackage } from '../bot/bot.service';

/**
 * Confirms, before cut-off, that BoT holds every bid we sent (TAD §7.4).
 *
 * A 201 from POST /bids says BoT received the batch; it does not say every bid is
 * registered, or stays registered. So each submitted batch is read back with
 * GET /bids and compared bid by bid. Anything missing, unexpected or rejected is a
 * break, raised while there is still time before cut-off to do something about it.
 *
 * The comparison also yields BoT's requestId for each of our bids — the key by which
 * BoT's callbacks are later matched to investors (Appendix B, B1) — and publishes it in
 * bot.batch.reconciled for the auction service.
 */

export interface Amendment {
  batchReference: string;
  isin: string;
  securityAccount: string;
  /** Face value before the amendment, to find the right bid when an account bid twice. */
  previousFaceValue: string;
  faceValue?: string;
  competitive?: boolean;
  price: string;
}

export interface PendingBatch {
  batchReference: string;
  packages: OutgoingPackage[];
  attempts: number;
}

export interface ReconcileStore {
  /** Batches not yet confirmed matched, oldest first. */
  pending(limit: number): Promise<PendingBatch[]>;
  /**
   * Records the outcome and announces it if it differs from the last one.
   * Returns true when the outcome changed.
   */
  saveResult(batchReference: string, result: BotBatchReconciledPayload): Promise<boolean>;
  /** Records an amendment made through the gateway, and queues the batch for checking again. */
  recordAmendment(amendment: Amendment): Promise<void>;
}

/** One submitted bid, in the shape used for matching. */
interface SentBid {
  isin: string;
  securityAccount: string;
  faceValue: string;
  competitive: boolean;
  price: string | null;
}

const normaliseFace = (value: string) => (value.includes('.') ? value : `${value}.00`);

/**
 * Matches what we sent against what BoT holds, one to one.
 *
 * A pair matches on ISIN, security account and face value. Each BoT bid can be used
 * once, so two identical bids from the same account in one batch need two BoT bids.
 */
export function matchBatch(
  batchReference: string,
  sent: SentBid[],
  atBot: (BotBidView & { isin: string })[],
): BotBatchReconciledPayload {
  const available = [...atBot];
  const bids: ReconciledBid[] = [];
  const missing: BotBatchReconciledPayload['missing'] = [];

  for (const bid of sent) {
    const index = available.findIndex(
      (candidate) =>
        candidate.isin === bid.isin &&
        candidate.securityAccount === bid.securityAccount &&
        candidate.faceValue === normaliseFace(bid.faceValue),
    );
    if (index === -1) {
      missing.push({
        isin: bid.isin,
        securityAccount: bid.securityAccount,
        faceValue: normaliseFace(bid.faceValue),
      });
      continue;
    }
    const [found] = available.splice(index, 1);
    if (!found) continue;
    bids.push({
      isin: bid.isin,
      securityAccount: bid.securityAccount,
      faceValue: found.faceValue,
      competitive: bid.competitive,
      price: bid.price,
      requestId: found.requestId,
      botStatus: found.status,
    });
  }

  const rejected = bids.filter((b) => b.botStatus === 'rejected');
  const unexpected = available.map((b) => ({
    isin: b.isin,
    requestId: b.requestId,
    securityAccount: b.securityAccount,
    faceValue: b.faceValue,
  }));
  const clean = missing.length === 0 && unexpected.length === 0 && rejected.length === 0;
  return {
    batchReference,
    status: clean ? 'matched' : 'breaks',
    bids,
    missing,
    unexpected,
    rejected,
  };
}

/** A reconciliation result, and whether it differs from the previous one. */
export type ReconcileOutcome = BotBatchReconciledPayload & { changed: boolean };

export class SubmissionReconciler {
  private running = false;

  constructor(
    private readonly bot: BotService,
    private readonly store: ReconcileStore,
  ) {}

  /** Checks every pending batch once. Overlapping runs are skipped. */
  async runOnce(limit = 20): Promise<ReconcileOutcome[] | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const results: ReconcileOutcome[] = [];
      for (const batch of await this.store.pending(limit)) {
        results.push(await this.reconcile(batch));
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  async reconcile(batch: PendingBatch): Promise<ReconcileOutcome> {
    const sent: SentBid[] = batch.packages.flatMap((pkg) =>
      pkg.bids.map((bid) => ({ isin: pkg.isin, ...bid })),
    );
    const isins = [...new Set(batch.packages.map((p) => p.isin))];
    const atBot: (BotBidView & { isin: string })[] = [];
    for (const isin of isins) {
      // Pages of at most 100 (spec §6); a retail batch can hold thousands of bids.
      for (let page = 1; page <= 200; page += 1) {
        const held = await this.bot.getBids(isin, {
          batchReference: batch.batchReference,
          page,
          limit: 100,
        });
        atBot.push(...held.map((bid) => ({ ...bid, isin })));
        if (held.length < 100) break;
      }
    }
    const result = matchBatch(batch.batchReference, sent, atBot);
    const changed = await this.store.saveResult(batch.batchReference, result);
    return { ...result, changed };
  }
}
