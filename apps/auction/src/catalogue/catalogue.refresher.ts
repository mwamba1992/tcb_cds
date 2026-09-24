import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { BotAuctionPayload } from '@govsec/events';
import { Neighbours } from '../clients/clients';
import { CatalogueService } from './catalogue.service';

/**
 * Loads the current auctions from bot-gateway at start-up and every five minutes.
 * Events keep the catalogue current between refreshes; this makes sure a restart, or
 * an event missed while the service was down, never leaves an auction out.
 */
@Injectable()
export class CatalogueRefresher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogueRefresher.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly neighbours: Neighbours,
    private readonly catalogue: CatalogueService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => void this.refresh(), 3_000).unref();
    this.timer = setInterval(() => void this.refresh(), 300_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const auctions = await this.neighbours.botGateway.get<BotAuctionPayload[]>('/internal/v1/auctions');
      for (const auction of auctions) await this.catalogue.upsertFromBot(auction);
      this.logger.log(`Catalogue refreshed: ${auctions.length} auctions`);
    } catch (error) {
      this.logger.warn(`Catalogue refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
