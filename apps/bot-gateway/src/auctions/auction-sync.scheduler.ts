import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG, type BotGatewayConfig } from '../config/configuration';
import { AuctionSyncService } from './auction-sync.service';

/**
 * Runs the auction sync on an interval (BOT_AUCTION_SYNC_MS, default five minutes;
 * 0 turns it off). BoT publishes no rate limits yet (Appendix B, B13), so the interval
 * is deliberately modest and a failed run just waits for the next one.
 */
@Injectable()
export class AuctionSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuctionSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sync: AuctionSyncService,
    @Inject(CONFIG) private readonly config: BotGatewayConfig,
  ) {}

  onModuleInit(): void {
    const interval = this.config.bot.auctionSyncMs;
    if (interval <= 0) {
      this.logger.log('Auction sync disabled (BOT_AUCTION_SYNC_MS=0)');
      return;
    }
    this.timer = setInterval(() => void this.run(), interval);
    // First run shortly after boot, not a full interval later.
    setTimeout(() => void this.run(), 2_000).unref();
    this.logger.log(`Auction sync every ${Math.round(interval / 1000)}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const result = await this.sync.syncOnce();
      if (result && (result.published || result.updated)) {
        this.logger.log(
          `Auctions: ${result.seen} seen, ${result.published} new, ${result.updated} changed`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Auction sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
