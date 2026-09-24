import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type AuthenticatedUser, type StepUpTokenClaims } from '@govsec/auth';
import { AUCTION_EVENTS, type BidEventPayload } from '@govsec/events';
import { NotifyClient } from '@govsec/notify';
import { generateReference } from '@govsec/reference';
import { Neighbours } from '../clients/clients';
import { UpstreamError } from '../clients/internal-http';
import { CONFIG, type AuctionConfig } from '../config/configuration';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { faceValueProblem, holdMinor, hundredthsToPrice, priceToHundredths, tzs } from './bid-rules';

export class BidError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra: object = {}) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}

const FACE_MESSAGES = {
  not_whole: 'Enter the face value in whole shillings',
  below_minimum: 'The face value is below the minimum for this auction',
  not_multiple: 'The face value must be a multiple of the bid step',
};

type BidRow = Awaited<ReturnType<PrismaService['bid']['findUniqueOrThrow']>> & {
  auction: { name: string; auctionDate: Date | null; tcbCutoffAt: Date | null };
};

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly neighbours: Neighbours,
    private readonly notify: NotifyClient,
    @Inject(CONFIG) private readonly config: AuctionConfig,
  ) {}

  async place(
    user: AuthenticatedUser,
    stepUp: StepUpTokenClaims,
    input: { isin: string; competitive: boolean; faceValue: string; price?: string | null },
    idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.bid.findUnique({
        where: { accountId_idempotencyKey: { accountId: user.accountId, idempotencyKey } },
        include: { auction: true },
      });
      if (existing) return view(existing);
    }

    const auction = await this.prisma.auction.findUnique({ where: { isin: input.isin } });
    if (!auction) throw new NotFoundException('Auction not found');
    this.assertOpen(auction);
    const { faceValue, priceHundredths } = this.validate(input, auction.instrument);

    const who = await this.eligible(user);
    const held = holdMinor(faceValue, priceHundredths, this.config.bidding.commissionBps);
    await this.spend(stepUp, user, PERMISSIONS.bidPlace, held);

    const reference = generateReference('bid');
    await this.hold(() => this.neighbours.placeHold(reference, who.bankAccount, tzs(held)));

    try {
      const bid = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bid.create({
          data: {
            reference,
            auctionId: auction.id,
            isin: auction.isin,
            investorId: who.investorId,
            accountId: user.accountId,
            cdsAccount: who.cdsAccount,
            bankAccount: who.bankAccount,
            competitive: input.competitive,
            faceValue,
            priceHundredths,
            heldMinor: held,
            idempotencyKey: idempotencyKey ?? null,
          },
          include: { auction: true },
        });
        await tx.outboxMessage.create({ data: bidEvent(AUCTION_EVENTS.bidPlaced, created) });
        return created;
      });
      void this.sms(user.accountId, 'bid.placed', {
        reference,
        amount: faceValue.toLocaleString('en-US'),
        security: auction.name,
        held: Number(tzs(held)).toLocaleString('en-US', { minimumFractionDigits: 2 }),
      });
      this.logger.log(`Bid ${reference} placed on ${auction.isin}: TZS ${faceValue} face, ${tzs(held)} held`);
      return view(bid);
    } catch (error) {
      // The funds are held but no bid exists: give them back.
      await this.neighbours.releaseHold(reference).catch(() => undefined);
      throw error;
    }
  }

  async amend(
    user: AuthenticatedUser,
    stepUp: StepUpTokenClaims,
    reference: string,
    input: { faceValue: string; price?: string | null },
  ) {
    const bid = await this.own(user, reference);
    if (bid.status !== 'placed') throw new BidError(HttpStatus.CONFLICT, 'not_amendable', 'This bid can no longer be changed');
    const auction = await this.prisma.auction.findUniqueOrThrow({ where: { id: bid.auctionId } });
    this.assertOpen(auction);
    const { faceValue, priceHundredths } = this.validate(
      { competitive: bid.competitive, faceValue: input.faceValue, price: input.price },
      auction.instrument,
    );
    const held = holdMinor(faceValue, priceHundredths, this.config.bidding.commissionBps);
    await this.spend(stepUp, user, PERMISSIONS.bidAmendOwn, held);
    await this.hold(() => this.neighbours.adjustHold(reference, tzs(held)));
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bid.update({
        where: { reference },
        data: { faceValue, priceHundredths, heldMinor: held },
        include: { auction: true },
      });
      await tx.outboxMessage.create({ data: bidEvent(AUCTION_EVENTS.bidAmended, changed) });
      return changed;
    });
    return view(updated);
  }

  /** No PIN needed: withdrawing only gives the investor their money back. */
  async withdraw(user: AuthenticatedUser, reference: string) {
    const bid = await this.own(user, reference);
    if (bid.status !== 'placed') throw new BidError(HttpStatus.CONFLICT, 'not_withdrawable', 'This bid can no longer be withdrawn');
    const auction = await this.prisma.auction.findUniqueOrThrow({ where: { id: bid.auctionId } });
    this.assertOpen(auction);
    const changed = await this.prisma.bid.updateMany({ where: { reference, status: 'placed' }, data: { status: 'withdrawn' } });
    if (changed.count !== 1) throw new BidError(HttpStatus.CONFLICT, 'not_withdrawable', 'This bid can no longer be withdrawn');
    await this.neighbours.releaseHold(reference);
    const withdrawn = await this.prisma.bid.findUniqueOrThrow({ where: { reference }, include: { auction: true } });
    await this.prisma.outboxMessage.create({ data: bidEvent(AUCTION_EVENTS.bidWithdrawn, withdrawn) });
    return view(withdrawn);
  }

  async mine(user: AuthenticatedUser) {
    const bids = await this.prisma.bid.findMany({
      where: { accountId: user.accountId },
      include: { auction: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return bids.map(view);
  }

  /** The investor's TCB account and what is free to bid with. */
  async funds(user: AuthenticatedUser) {
    const who = await this.neighbours.eligibility(user.accountId).catch(() => null);
    if (!who?.bankAccount) return { bankAccount: null, available: null, onHold: null, canBid: false, cdsAccount: who?.cdsAccount ?? null };
    const balance = await this.neighbours.balance(who.bankAccount);
    return {
      bankAccount: who.bankAccount,
      available: balance.available,
      onHold: balance.onHold,
      canBid: who.canBid,
      cdsAccount: who.cdsAccount,
      firstName: who.firstName,
    };
  }

  // ------------------------------------------------------------------ steps

  private assertOpen(auction: { botStatus: string; tcbCutoffAt: Date | null }) {
    if (auction.botStatus === 'closed' || !auction.tcbCutoffAt || new Date() >= auction.tcbCutoffAt) {
      throw new BidError(HttpStatus.CONFLICT, 'bidding_closed', 'Bidding for this auction has closed');
    }
  }

  private validate(input: { competitive: boolean; faceValue: string; price?: string | null }, instrument: string) {
    const problem = faceValueProblem(input.faceValue, instrument, this.config.bidding);
    if (problem) throw new BidError(HttpStatus.BAD_REQUEST, `face_value_${problem}`, FACE_MESSAGES[problem]);
    let priceHundredths: number | null = null;
    if (input.competitive) {
      priceHundredths = input.price ? priceToHundredths(input.price) : null;
      if (priceHundredths === null) {
        throw new BidError(HttpStatus.BAD_REQUEST, 'invalid_price', 'Enter a price per 100 with at most two decimals');
      }
    }
    return { faceValue: BigInt(input.faceValue), priceHundredths };
  }

  private async eligible(user: AuthenticatedUser) {
    const who = await this.neighbours.eligibility(user.accountId).catch(() => null);
    if (!who?.canBid || !who.cdsAccount || !who.bankAccount) {
      throw new BidError(HttpStatus.FORBIDDEN, 'not_ready', 'Your account is not yet ready to bid');
    }
    return { ...who, cdsAccount: who.cdsAccount, bankAccount: who.bankAccount };
  }

  /**
   * The PIN approval must cover what will be held, and is spent here — once. A grant
   * without an amount ceiling is refused for bids: it would approve any amount.
   */
  private async spend(stepUp: StepUpTokenClaims, user: AuthenticatedUser, scope: string, held: bigint) {
    if (!stepUp.maxAmountMinor || BigInt(stepUp.maxAmountMinor) < held) {
      throw new ForbiddenException({ code: 'step_up_amount', message: 'The PIN approval does not cover this amount; approve again' });
    }
    try {
      await this.neighbours.redeemStepUp({ grantId: stepUp.jti, accountId: user.accountId, scope, amountMinor: held });
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 403) {
        throw new ForbiddenException({ code: 'step_up_used', message: 'This PIN approval has been used or has expired; enter your PIN again' });
      }
      throw error;
    }
  }

  private async hold(call: () => Promise<unknown>) {
    try {
      await call();
    } catch (error) {
      if (error instanceof UpstreamError && error.code === 'insufficient_funds') {
        throw new BidError(HttpStatus.CONFLICT, 'insufficient_funds', 'Not enough available balance on your TCB account', {
          available: error.body['available'],
        });
      }
      throw error;
    }
  }

  private async own(user: AuthenticatedUser, reference: string) {
    const bid = await this.prisma.bid.findUnique({ where: { reference } });
    // Someone else's bid reads as not found: references are not secrets, but bids are.
    if (!bid || bid.accountId !== user.accountId) throw new NotFoundException('Bid not found');
    return bid;
  }

  async sms(accountId: string, templateKey: string, variables: Record<string, string>) {
    try {
      const contact = await this.neighbours.identity.get<{ phoneNumber: string; locale: 'sw' | 'en' }>(
        `/internal/v1/accounts/${accountId}/contact`,
      );
      await this.notify.send({ destination: contact.phoneNumber, templateKey, category: 'auction', locale: contact.locale, variables });
    } catch (error) {
      this.logger.warn(`SMS ${templateKey} not sent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function bidEvent(eventType: string, bid: BidRow | (Omit<BidRow, 'auction'> & { auction?: unknown }), extra: Record<string, unknown> = {}) {
  const payload: BidEventPayload = {
    bidReference: bid.reference,
    investorId: bid.investorId,
    accountId: bid.accountId,
    isin: bid.isin,
    faceValue: bid.faceValue.toString(),
    competitive: bid.competitive,
    price: bid.priceHundredths === null ? null : hundredthsToPrice(bid.priceHundredths),
    held: tzs(bid.heldMinor),
    at: new Date().toISOString(),
  };
  return outboxRow({
    aggregateType: 'bid',
    aggregateId: bid.reference,
    eventType,
    dedupeKey: `${bid.reference}:${bid.status}:${bid.updatedAt.getTime()}`,
    payload: { ...payload, ...extra },
  });
}

export function view(bid: BidRow) {
  return {
    reference: bid.reference,
    isin: bid.isin,
    security: bid.auction.name,
    auctionDate: bid.auction.auctionDate?.toISOString().slice(0, 10) ?? null,
    cutoffAt: bid.auction.tcbCutoffAt,
    competitive: bid.competitive,
    faceValue: bid.faceValue.toString(),
    price: bid.priceHundredths === null ? null : hundredthsToPrice(bid.priceHundredths),
    held: tzs(bid.heldMinor),
    status: bid.status,
    allottedFaceValue: bid.allottedFaceValue?.toString() ?? null,
    allottedPrice: bid.allottedPriceHundredths === null ? null : hundredthsToPrice(bid.allottedPriceHundredths),
    message: bid.botMessage,
    placedAt: bid.createdAt,
  };
}
