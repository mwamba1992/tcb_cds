import { createHash } from 'node:crypto';
import { BOT_EVENTS, type BotAuctionPayload } from '@govsec/events';
import type { AuctionSummary, BotService } from '../bot/bot.service';

/**
 * Keeps the platform's view of BoT's auctions current (TAD §7.3).
 *
 * BoT publishes auctions on GET /auctions; it does not push them. Each sync compares
 * what BoT returns with the last snapshot of each ISIN and publishes only what changed:
 * `bot.auction.published` the first time an ISIN is seen, `bot.auction.updated` when
 * any field differs. An unchanged auction produces nothing, so consumers are not
 * flooded every poll.
 */

export interface SnapshotChange {
  kind: 'published' | 'updated';
  isin: string;
  hash: string;
  auction: BotAuctionPayload;
}

export interface SnapshotStore {
  /** Current hash per ISIN, for the ISINs asked about. */
  hashes(isins: string[]): Promise<Map<string, string>>;
  /** Saves new snapshots and their events together. */
  apply(changes: SnapshotChange[]): Promise<void>;
}

export interface SyncResult {
  seen: number;
  published: number;
  updated: number;
}

export function auctionHash(auction: AuctionSummary): string {
  // Stable field order, so the same auction always hashes the same.
  const canonical = JSON.stringify([
    auction.isin,
    auction.name,
    auction.instrument,
    auction.auctionDate,
    auction.maturityDate,
    auction.competitiveOffer,
    auction.nonCompetitiveOffer,
    auction.status,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export class AuctionSyncService {
  private running = false;

  constructor(
    private readonly bot: BotService,
    private readonly store: SnapshotStore,
  ) {}

  /** One sync. Overlapping calls are skipped rather than queued. */
  async syncOnce(): Promise<SyncResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const auctions = await this.allAuctions();
      const known = await this.store.hashes(auctions.map((a) => a.isin));
      const changes: SnapshotChange[] = [];
      for (const auction of auctions) {
        const hash = auctionHash(auction);
        const previous = known.get(auction.isin);
        if (previous === hash) continue;
        changes.push({
          kind: previous ? 'updated' : 'published',
          isin: auction.isin,
          hash,
          auction,
        });
      }
      if (changes.length > 0) await this.store.apply(changes);
      return {
        seen: auctions.length,
        published: changes.filter((c) => c.kind === 'published').length,
        updated: changes.filter((c) => c.kind === 'updated').length,
      };
    } finally {
      this.running = false;
    }
  }

  /** Pages through GET /auctions (at most 100 per page, spec §5). */
  private async allAuctions(): Promise<AuctionSummary[]> {
    const all: AuctionSummary[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const batch = await this.bot.listAuctions({ page, limit: 100 });
      all.push(...batch.filter((a) => a.isin !== ''));
      if (batch.length < 100) break;
    }
    return all;
  }
}

export const AUCTION_EVENT = {
  published: BOT_EVENTS.auctionPublished,
  updated: BOT_EVENTS.auctionUpdated,
} as const;
