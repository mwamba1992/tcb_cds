import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type AuthenticatedUser, type StepUpTokenClaims } from '@govsec/auth';
import { AUCTION_EVENTS, type BatchEventPayload } from '@govsec/events';
import { tableOrder, tablePage, tableWindow, type TableQuery } from '@govsec/pagination';
import { state } from '../catalogue/catalogue.service';
import { Neighbours } from '../clients/clients';
import { UpstreamError } from '../clients/internal-http';
import { CONFIG, type AuctionConfig } from '../config/configuration';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { batchReference, hundredthsToPrice, tzs } from '../bids/bid-rules';

/**
 * Batches to BoT, with maker-checker.
 *
 * An operations officer prepares a batch once TCB's cut-off has passed; a different
 * supervisor approves it (with a fresh approval of their own), and approval sends it.
 * If BoT cannot be reached the batch is marked failed and can be sent again: the
 * gateway and BoT are both idempotent on the batch reference, so a resend never
 * submits the bids twice.
 */
@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly neighbours: Neighbours,
    @Inject(CONFIG) private readonly config: AuctionConfig,
  ) {}

  /** One row per recent auction: where bidding and submission stand. */
  async control(now = new Date()) {
    const auctions = await this.prisma.auction.findMany({
      where: { OR: [{ auctionDate: { gte: new Date(now.getTime() - 14 * 86_400_000) } }, { auctionDate: null }] },
      orderBy: [{ tcbCutoffAt: 'asc' }, { isin: 'asc' }],
      include: {
        bids: { select: { status: true, faceValue: true, heldMinor: true, competitive: true } },
        batches: { orderBy: { preparedAt: 'desc' }, take: 1 },
      },
    });
    return auctions.map((a) => {
      const live = a.bids.filter((b) => b.status !== 'withdrawn');
      const waiting = a.bids.filter((b) => b.status === 'placed');
      const batch = a.batches[0] ?? null;
      return {
        isin: a.isin,
        name: a.name,
        auctionDate: a.auctionDate?.toISOString().slice(0, 10) ?? null,
        cutoffAt: a.tcbCutoffAt,
        botCloseAt: a.botCloseAt,
        state: state(a, now),
        bids: live.length,
        competitive: live.filter((b) => b.competitive).length,
        nonCompetitive: live.filter((b) => !b.competitive).length,
        faceValue: live.reduce((s, b) => s + b.faceValue, 0n).toString(),
        // Only holds still in place: unsuccessful and rejected bids have been released.
        held: tzs(
          live.filter((b) => !['unsuccessful', 'rejected'].includes(b.status)).reduce((s, b) => s + b.heldMinor, 0n),
        ),
        awaitingBatch: waiting.length,
        batch: batch && {
          id: batch.id,
          reference: batch.reference,
          status: batch.status,
          preparedByName: batch.preparedByName,
          approvedByName: batch.approvedByName,
        },
      };
    });
  }

  async list(query: TableQuery & { status?: string }) {
    const window = tableWindow(query);
    const q = query.q?.trim();
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(q ? { OR: [{ reference: { contains: q.toUpperCase() } }, { isin: { contains: q.toUpperCase() } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.batch.findMany({
        where,
        include: { auction: { select: { name: true } } },
        orderBy: tableOrder(query.sort, { prepared: 'preparedAt', status: 'status' }, { field: 'prepared', dir: 'desc' }),
        skip: window.skip,
        take: window.take,
      }),
      this.prisma.batch.count({ where }),
    ]);
    return tablePage(rows.map(batchView), total, window);
  }

  async get(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { auction: { select: { name: true } }, bids: { orderBy: { createdAt: 'asc' } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return {
      ...batchView(batch),
      bids: batch.bids.map((b) => ({
        reference: b.reference,
        cdsAccount: b.cdsAccount,
        competitive: b.competitive,
        faceValue: b.faceValue.toString(),
        price: b.priceHundredths === null ? null : hundredthsToPrice(b.priceHundredths),
        held: tzs(b.heldMinor),
        status: b.status,
        botRequestId: b.botRequestId,
      })),
    };
  }

  async prepare(actor: AuthenticatedUser, isin: string) {
    const auction = await this.prisma.auction.findUnique({ where: { isin } });
    if (!auction) throw new NotFoundException('Auction not found');
    const now = new Date();
    const s = state(auction, now);
    if (s === 'open') {
      throw new ConflictException({ code: 'bidding_open', message: 'Bidding is still open; prepare after TCB’s cut-off' });
    }
    if (s === 'closed' || (auction.botCloseAt && now >= auction.botCloseAt)) {
      throw new ConflictException({ code: 'bot_closed', message: 'BoT has closed this auction' });
    }

    const batch = await this.prisma.$transaction(async (tx) => {
      const bids = await tx.bid.findMany({ where: { auctionId: auction.id, status: 'placed' } });
      if (bids.length === 0) {
        throw new ConflictException({ code: 'no_bids', message: 'No bids are waiting for a batch' });
      }
      const day = auction.auctionDate ?? now;
      const sameDay = await tx.batch.count({ where: { reference: { startsWith: batchReference(this.config.participantCode, day, 1).slice(0, 15) } } });
      const created = await tx.batch.create({
        data: {
          reference: batchReference(this.config.participantCode, day, sameDay + 1),
          auctionId: auction.id,
          isin,
          bidCount: bids.length,
          totalFaceValue: bids.reduce((s, b) => s + b.faceValue, 0n),
          totalHeldMinor: bids.reduce((s, b) => s + b.heldMinor, 0n),
          preparedBy: actor.accountId,
          preparedByName: actor.name ?? null,
        },
      });
      // Conditional: a bid withdrawn in the same instant is left out, not swept in.
      const moved = await tx.bid.updateMany({
        where: { id: { in: bids.map((b) => b.id) }, status: 'placed' },
        data: { status: 'in_batch', batchId: created.id },
      });
      if (moved.count !== bids.length) {
        throw new ConflictException({ code: 'invalid_state', message: 'Bids changed while preparing; try again' });
      }
      await tx.outboxMessage.create({ data: batchEvent(AUCTION_EVENTS.batchPrepared, created) });
      return created;
    });
    this.logger.log(`Batch ${batch.reference} prepared by ${actor.name}: ${batch.bidCount} bids`);
    return this.get(batch.id);
  }

  async approve(actor: AuthenticatedUser, stepUp: StepUpTokenClaims, id: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status !== 'prepared') {
      throw new ConflictException({ code: 'invalid_state', message: 'This batch is not waiting for approval' });
    }
    if (batch.preparedBy === actor.accountId) {
      throw new ForbiddenException({ code: 'maker_checker', message: 'A different user must approve a batch you prepared' });
    }
    try {
      await this.neighbours.redeemStepUp({ grantId: stepUp.jti, accountId: actor.accountId, scope: PERMISSIONS.batchApprove });
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 403) {
        throw new ForbiddenException({ code: 'step_up_used', message: 'This approval has been used or has expired; confirm again' });
      }
      throw error;
    }
    const approved = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.batch.updateMany({
        where: { id, status: 'prepared' },
        data: { status: 'approved', approvedBy: actor.accountId, approvedByName: actor.name ?? null, approvedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'invalid_state', message: 'Someone else acted on this batch first' });
      const row = await tx.batch.findUniqueOrThrow({ where: { id } });
      await tx.outboxMessage.create({ data: batchEvent(AUCTION_EVENTS.batchApproved, row) });
      return row;
    });
    this.logger.log(`Batch ${approved.reference} approved by ${actor.name}`);
    return this.submit(id);
  }

  /** Send an approved (or failed) batch. Safe to repeat. */
  async submit(id: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id }, include: { bids: true } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status !== 'approved' && batch.status !== 'failed') {
      throw new ConflictException({ code: 'invalid_state', message: 'Only an approved or failed batch can be sent' });
    }
    const bids = batch.bids.filter((b) => b.status === 'in_batch' || b.status === 'submitted');
    try {
      await this.neighbours.submitBatch(batch.reference, [
        {
          isin: batch.isin,
          bids: bids.map((b) => ({
            securityAccount: b.cdsAccount,
            faceValue: b.faceValue.toString(),
            competitive: b.competitive,
            price: b.priceHundredths === null ? null : hundredthsToPrice(b.priceHundredths),
          })),
        },
      ]);
    } catch (error) {
      const message =
        error instanceof UpstreamError
          ? `${error.message}${error.body['message'] ? `: ${String(error.body['message'])}` : ''}`
          : String(error);
      await this.prisma.batch.update({ where: { id }, data: { status: 'failed', lastError: message.slice(0, 500) } });
      this.logger.error(`Batch ${batch.reference} not sent: ${message}`);
      return this.get(id);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.batch.update({ where: { id }, data: { status: 'submitted', submittedAt: new Date(), lastError: null } });
      await tx.bid.updateMany({ where: { batchId: id, status: 'in_batch' }, data: { status: 'submitted' } });
      await tx.outboxMessage.create({ data: batchEvent(AUCTION_EVENTS.batchSubmitted, batch) });
    });
    this.logger.log(`Batch ${batch.reference} submitted to BoT: ${bids.length} bids`);
    return this.get(id);
  }
}

function batchView(b: {
  id: string;
  reference: string;
  isin: string;
  status: string;
  bidCount: number;
  totalFaceValue: bigint;
  totalHeldMinor: bigint;
  preparedByName: string | null;
  preparedAt: Date;
  approvedByName: string | null;
  approvedAt: Date | null;
  submittedAt: Date | null;
  reconciledAt: Date | null;
  lastError: string | null;
  auction: { name: string };
}) {
  return {
    id: b.id,
    reference: b.reference,
    isin: b.isin,
    security: b.auction.name,
    status: b.status,
    bids: b.bidCount,
    faceValue: b.totalFaceValue.toString(),
    held: tzs(b.totalHeldMinor),
    preparedBy: b.preparedByName,
    preparedAt: b.preparedAt,
    approvedBy: b.approvedByName,
    approvedAt: b.approvedAt,
    submittedAt: b.submittedAt,
    reconciledAt: b.reconciledAt,
    lastError: b.lastError,
  };
}

function batchEvent(eventType: string, b: { id: string; reference: string; isin: string; bidCount: number; totalFaceValue: bigint }) {
  const payload: BatchEventPayload = {
    batchId: b.id,
    batchReference: b.reference,
    isin: b.isin,
    bids: b.bidCount,
    totalFaceValue: b.totalFaceValue.toString(),
    at: new Date().toISOString(),
  };
  return outboxRow({ aggregateType: 'batch', aggregateId: b.id, eventType, dedupeKey: `${b.id}:${eventType}`, payload: { ...payload } });
}
