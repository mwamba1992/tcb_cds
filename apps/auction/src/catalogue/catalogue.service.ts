import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '@govsec/auth';
import { Money } from '@govsec/money';
import type { BotAuctionPayload } from '@govsec/events';
import { CONFIG, type AuctionConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { botCloseAt, hundredthsToPrice, minimumBid, tcbCutoffAt } from '../bids/bid-rules';

export type AuctionState = 'open' | 'closed_for_bids' | 'closed';

/**
 * Auctions, as bot-gateway reports them, with TCB's own cut-off.
 *
 * BoT's feed has no closing time (Appendix B4), so BoT's close is taken as the
 * configured time on the auction date and TCB's cut-off a configured number of hours
 * earlier. Staff can bring the cut-off forward for one auction, with a reason.
 */
@Injectable()
export class CatalogueService {
  private readonly logger = new Logger(CatalogueService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AuctionConfig,
  ) {}

  async upsertFromBot(a: BotAuctionPayload): Promise<void> {
    const auctionDate = a.auctionDate ? new Date(`${a.auctionDate}T00:00:00Z`) : null;
    const botClose = auctionDate ? botCloseAt(auctionDate, this.config.bidding.botCloseTime) : null;
    const cutoff = botClose ? tcbCutoffAt(botClose, this.config.bidding.cutoffHoursBeforeBot) : null;
    const data = {
      name: a.name,
      instrument: a.instrument,
      auctionDate,
      maturityDate: a.maturityDate ? new Date(`${a.maturityDate}T00:00:00Z`) : null,
      competitiveOffer: a.competitiveOffer,
      nonCompetitiveOffer: a.nonCompetitiveOffer,
      botStatus: a.status,
      botCloseAt: botClose,
    };
    const existing = await this.prisma.auction.findUnique({ where: { isin: a.isin } });
    if (!existing) {
      await this.prisma.auction.create({ data: { isin: a.isin, ...data, tcbCutoffAt: cutoff } });
      this.logger.log(`Auction ${a.isin} (${a.name}) added; TCB cut-off ${cutoff?.toISOString() ?? 'unknown'}`);
      return;
    }
    // A cut-off staff brought forward is kept; otherwise it follows the auction date.
    await this.prisma.auction.update({
      where: { isin: a.isin },
      data: { ...data, ...(existing.closedEarlyBy ? {} : { tcbCutoffAt: cutoff }) },
    });
  }

  async list(now = new Date()) {
    const auctions = await this.prisma.auction.findMany({
      where: { OR: [{ auctionDate: { gte: new Date(now.getTime() - 14 * 86_400_000) } }, { auctionDate: null }] },
      orderBy: [{ tcbCutoffAt: 'asc' }, { isin: 'asc' }],
    });
    return auctions.map((a) => this.view(a, now));
  }

  async get(isin: string, now = new Date()) {
    const auction = await this.prisma.auction.findUnique({ where: { isin } });
    if (!auction) throw new NotFoundException('Auction not found');
    return this.view(auction, now);
  }

  /** Staff: stop taking bids now, e.g. to submit early. Audited on the auction row. */
  async closeBidding(isin: string, actor: AuthenticatedUser, reason: string) {
    const auction = await this.prisma.auction.findUnique({ where: { isin } });
    if (!auction) throw new NotFoundException('Auction not found');
    if (state(auction, new Date()) !== 'open') {
      throw new ConflictException({ code: 'invalid_state', message: 'Bidding is already closed for this auction' });
    }
    await this.prisma.auction.update({
      where: { isin },
      data: { tcbCutoffAt: new Date(), closedEarlyBy: actor.name ?? actor.accountId, closedEarlyReason: reason },
    });
    this.logger.warn(`Bidding for ${isin} closed early by ${actor.name ?? actor.accountId}: ${reason}`);
    return this.get(isin);
  }

  view(
    a: {
      isin: string;
      name: string;
      instrument: string;
      auctionDate: Date | null;
      maturityDate: Date | null;
      competitiveOffer: string;
      nonCompetitiveOffer: string;
      botStatus: string;
      botCloseAt: Date | null;
      tcbCutoffAt: Date | null;
      closedEarlyBy: string | null;
    },
    now: Date,
  ) {
    const b = this.config.bidding;
    return {
      isin: a.isin,
      name: a.name,
      instrument: a.instrument,
      tenorDays:
        a.auctionDate && a.maturityDate
          ? Math.round((a.maturityDate.getTime() - a.auctionDate.getTime()) / 86_400_000)
          : null,
      auctionDate: a.auctionDate?.toISOString().slice(0, 10) ?? null,
      maturityDate: a.maturityDate?.toISOString().slice(0, 10) ?? null,
      offerSize: Money.parse(a.competitiveOffer || '0', 'TZS')
        .add(Money.parse(a.nonCompetitiveOffer || '0', 'TZS'))
        .toString(),
      botCloseAt: a.botCloseAt,
      cutoffAt: a.tcbCutoffAt,
      closedEarly: a.closedEarlyBy !== null,
      state: state(a, now),
      rules: {
        minimumBid: String(minimumBid(a.instrument, b)),
        bidMultiple: String(b.bidMultiple),
        commissionBps: b.commissionBps,
      },
      // A starting value for the bid form, not advice: par less a typical discount.
      indicativePrice: hundredthsToPrice(a.instrument === 'bond' ? 10000 : 8850),
    };
  }
}

export function state(a: { botStatus: string; tcbCutoffAt: Date | null }, now: Date): AuctionState {
  if (a.botStatus === 'closed') return 'closed';
  if (!a.tcbCutoffAt || now >= a.tcbCutoffAt) return 'closed_for_bids';
  return 'open';
}
