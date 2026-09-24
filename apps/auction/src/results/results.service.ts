import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUCTION_EVENTS, type BotBatchReconciledPayload, type BotBidOutcomePayload } from '@govsec/events';
import { Money } from '@govsec/money';
import { Neighbours } from '../clients/clients';
import { CONFIG, type AuctionConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { BidsService, bidEvent } from '../bids/bids.service';
import { holdMinor, hundredthsToPrice, priceToHundredths, tzs } from '../bids/bid-rules';

type Outcome = 'accepted' | 'rejected' | 'allotted' | 'unsuccessful';

/** Once a bid reaches one of these, nothing later changes it. */
const FINAL = ['rejected', 'allotted', 'partially_allotted', 'unsuccessful', 'withdrawn'];

/**
 * BoT's verdicts, applied to our bids.
 *
 * BoT identifies a bid only by its own requestId. Which of our bids a requestId is
 * becomes known when bot-gateway reconciles the batch against BoT (bot.batch.reconciled,
 * matching CDS account, face value and price). A callback can arrive before that, so
 * every outcome is stored first and applied as soon as its bid is known — whichever
 * order the two arrive in.
 */
@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly neighbours: Neighbours,
    private readonly bids: BidsService,
    @Inject(CONFIG) private readonly config: AuctionConfig,
  ) {}

  async onReconciled(payload: BotBatchReconciledPayload): Promise<void> {
    const batch = await this.prisma.batch.findUnique({ where: { reference: payload.batchReference }, include: { bids: true } });
    if (!batch) {
      this.logger.warn(`Reconciliation for unknown batch ${payload.batchReference}; ignored`);
      return;
    }
    const unmatched = batch.bids.filter((b) => b.botRequestId === null);
    const mapped: string[] = [];
    for (const theirs of [...payload.bids, ...payload.rejected]) {
      if (await this.prisma.bid.findUnique({ where: { botRequestId: theirs.requestId } })) continue;
      const price = theirs.price === null ? null : priceToHundredths(theirs.price);
      const index = unmatched.findIndex(
        (b) =>
          b.cdsAccount === theirs.securityAccount &&
          b.faceValue.toString() === theirs.faceValue.replace(/\.00$/, '') &&
          b.competitive === theirs.competitive &&
          b.priceHundredths === price,
      );
      const ours = index >= 0 ? unmatched.splice(index, 1)[0] : undefined;
      if (!ours) {
        this.logger.warn(`BoT request ${theirs.requestId} in ${batch.reference} matches none of our bids`);
        continue;
      }
      await this.prisma.bid.update({ where: { id: ours.id }, data: { botRequestId: theirs.requestId } });
      mapped.push(theirs.requestId);
    }
    for (const rejected of payload.rejected) {
      await this.record(`reconcile:${batch.reference}:${rejected.requestId}`, rejected.requestId, 'rejected', null, null, 'Rejected by BoT', new Date());
    }
    if (payload.status === 'matched' || unmatched.length === 0) {
      await this.prisma.batch.update({ where: { id: batch.id }, data: { status: 'reconciled', reconciledAt: new Date() } });
    }
    for (const requestId of mapped) await this.applyPending(requestId);
    this.logger.log(`Batch ${batch.reference} reconciled: ${mapped.length} bids matched to BoT requests`);
  }

  async onOutcome(eventKey: string, outcome: Outcome, payload: BotBidOutcomePayload): Promise<void> {
    if (!payload.requestId) {
      this.logger.warn(`BoT ${outcome} without a requestId (batch ${payload.batchReference ?? '?'}); cannot be matched`);
      return;
    }
    await this.record(eventKey, payload.requestId, outcome, payload.allottedFaceValue, payload.allottedPrice, payload.message, new Date(payload.receivedAt));
    await this.applyPending(payload.requestId);
  }

  private async record(
    eventKey: string,
    requestId: string,
    outcome: Outcome,
    allottedFaceValue: string | null,
    allottedPrice: string | null,
    message: string | null,
    receivedAt: Date,
  ) {
    await this.prisma.bidOutcome.createMany({
      skipDuplicates: true,
      data: [{ eventKey, requestId, outcome, allottedFaceValue, allottedPrice, message: message?.slice(0, 300) ?? null, receivedAt }],
    });
  }

  /** Apply, in the order BoT sent them, every stored outcome for a requestId whose bid is known. */
  private async applyPending(requestId: string): Promise<void> {
    const bid = await this.prisma.bid.findUnique({ where: { botRequestId: requestId }, include: { auction: true } });
    if (!bid) return;
    const pending = await this.prisma.bidOutcome.findMany({
      where: { requestId, appliedAt: null },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });
    for (const outcome of pending) {
      await this.apply(bid.id, outcome.outcome as Outcome, outcome.allottedFaceValue, outcome.allottedPrice, outcome.message);
      await this.prisma.bidOutcome.update({ where: { id: outcome.id }, data: { appliedAt: new Date() } });
    }
  }

  private async apply(bidId: string, outcome: Outcome, allottedFace: string | null, allottedPrice: string | null, message: string | null) {
    const bid = await this.prisma.bid.findUniqueOrThrow({ where: { id: bidId }, include: { auction: true } });
    if (FINAL.includes(bid.status)) return;
    if (outcome === 'accepted') {
      if (bid.status === 'submitted' || bid.status === 'in_batch') {
        await this.prisma.bid.update({ where: { id: bidId }, data: { status: 'accepted', botMessage: message } });
      }
      return;
    }

    let status: string = outcome;
    let allottedFaceValue: bigint | null = null;
    let allottedPriceHundredths: number | null = null;
    let newHold: bigint | null = null;
    if (outcome === 'allotted') {
      allottedFaceValue = allottedFace ? Money.parse(allottedFace, 'TZS').minorUnits / 100n : bid.faceValue;
      allottedPriceHundredths = allottedPrice ? priceToHundredths(allottedPrice) : bid.priceHundredths;
      status = allottedFaceValue < bid.faceValue ? 'partially_allotted' : 'allotted';
      // Keep exactly what the allotment will cost; release the rest now.
      newHold = holdMinor(allottedFaceValue, allottedPriceHundredths ?? 10000, this.config.bidding.commissionBps);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bid.update({
        where: { id: bidId },
        data: { status, allottedFaceValue, allottedPriceHundredths, botMessage: message, ...(newHold !== null ? { heldMinor: newHold } : {}) },
        include: { auction: true },
      });
      await tx.outboxMessage.create({
        data: bidEvent(AUCTION_EVENTS.bidResult, changed, {
          result: status,
          allottedFaceValue: allottedFaceValue?.toString() ?? null,
          allottedPrice: allottedPriceHundredths === null ? null : hundredthsToPrice(allottedPriceHundredths),
        }),
      });
      return changed;
    });

    // Money back first, message second.
    try {
      if (newHold === null) await this.neighbours.releaseHold(bid.reference);
      else if (newHold < bid.heldMinor) await this.neighbours.adjustHold(bid.reference, tzs(newHold));
    } catch (error) {
      this.logger.error(`Hold for ${bid.reference} not adjusted after ${status}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const money = (minor: bigint) => Number(tzs(minor)).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const common = { reference: bid.reference, security: bid.auction.name };
    if (status === 'allotted' || status === 'partially_allotted') {
      await this.bids.sms(bid.accountId, `bid.${status}`, {
        ...common,
        allotted: (updated.allottedFaceValue ?? 0n).toLocaleString('en-US'),
        amount: bid.faceValue.toLocaleString('en-US'),
        price: allottedPriceHundredths === null ? '—' : hundredthsToPrice(allottedPriceHundredths),
      });
    } else {
      await this.bids.sms(bid.accountId, `bid.${status}`, { ...common, held: money(bid.heldMinor) });
    }
    this.logger.log(`Bid ${bid.reference}: ${status}`);
  }
}
