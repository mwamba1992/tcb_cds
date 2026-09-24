import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import { AUCTION_EVENT, type SnapshotChange, type SnapshotStore } from './auction-sync.service';

@Injectable()
export class PrismaSnapshotStore implements SnapshotStore {
  constructor(private readonly prisma: PrismaService) {}

  async hashes(isins: string[]): Promise<Map<string, string>> {
    if (isins.length === 0) return new Map();
    const rows = await this.prisma.auctionSnapshot.findMany({
      where: { isin: { in: isins } },
      select: { isin: true, hash: true },
    });
    return new Map(rows.map((row) => [row.isin, row.hash]));
  }

  /** Snapshot and event in one transaction, so a change is never recorded unannounced. */
  async apply(changes: SnapshotChange[]): Promise<void> {
    await this.prisma.$transaction(
      changes.flatMap((change) => {
        const payload = change.auction as unknown as Prisma.InputJsonValue;
        return [
          this.prisma.auctionSnapshot.upsert({
            where: { isin: change.isin },
            create: { isin: change.isin, hash: change.hash, payload },
            update: { hash: change.hash, payload },
          }),
          this.prisma.outboxMessage.create({
            data: outboxRow({
              aggregateType: 'auction',
              aggregateId: change.isin,
              eventType: AUCTION_EVENT[change.kind],
              payload: { ...change.auction },
              // Same auction content, same key: a re-run cannot announce it twice.
              dedupeKey: `${change.isin}:${change.hash}`,
            }),
          }),
        ];
      }),
    );
  }
}
