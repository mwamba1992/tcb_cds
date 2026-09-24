import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly, Public } from '@govsec/auth';
import type { BotAuctionPayload } from '@govsec/events';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The auctions as last seen at BoT, for the auction service.
 *
 * Events carry changes; this carries state. A consumer that starts after an auction
 * was published would otherwise never learn of it, because nothing about it changes
 * again until BoT closes it.
 */
@ApiExcludeController()
@Public()
@Controller('internal/v1/auctions')
export class InternalAuctionsController {
  constructor(private readonly prisma: PrismaService) {}

  @InternalOnly('auction')
  @Get()
  async current(): Promise<BotAuctionPayload[]> {
    const rows = await this.prisma.auctionSnapshot.findMany({ orderBy: { isin: 'asc' } });
    return rows.map((r) => r.payload as unknown as BotAuctionPayload);
  }
}
