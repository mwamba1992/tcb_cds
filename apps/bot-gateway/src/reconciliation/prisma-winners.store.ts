import { Injectable } from '@nestjs/common';
import { BOT_EVENTS, type BotWinnersCheckedPayload } from '@govsec/events';
import { outboxRow } from '../outbox/outbox.store';
import { PrismaService } from '../prisma/prisma.service';
import type { WinnersCandidate, WinnersStore } from './winners-check';

@Injectable()
export class PrismaWinnersStore implements WinnersStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ISINs with allotment callbacks in the last week whose totals are not yet
   * confirmed. The sum is done in Postgres NUMERIC and returned as text, so no amount
   * passes through a float on the way.
   */
  async candidates(): Promise<WinnersCandidate[]> {
    const rows = await this.prisma.$queryRaw<{ isin: string; total: string }[]>`
      SELECT c.isin,
             SUM((c.payload -> 'data' ->> 'allottedAmount')::numeric)::numeric(20, 2)::text AS total
        FROM bot_callbacks c
        LEFT JOIN winners_checks w ON w.isin = c.isin
       WHERE c.status = 'allotted'
         AND c.isin IS NOT NULL
         AND c.received_at > now() - interval '7 days'
         AND (w.status IS NULL OR w.status <> 'matched')
       GROUP BY c.isin
       ORDER BY c.isin
    `;
    return rows.map((row) => ({ isin: row.isin, callbacksTotal: row.total }));
  }

  async save(result: BotWinnersCheckedPayload): Promise<boolean> {
    const [, inserted] = await this.prisma.$transaction([
      this.prisma.winnersCheck.upsert({
        where: { isin: result.isin },
        create: {
          isin: result.isin,
          status: result.status,
          callbacksTotal: result.callbacksTotal,
          winnersTotal: result.winnersTotal,
        },
        update: {
          status: result.status,
          callbacksTotal: result.callbacksTotal,
          winnersTotal: result.winnersTotal,
          attempts: { increment: 1 },
          checkedAt: new Date(),
        },
      }),
      this.prisma.outboxMessage.createMany({
        data: [
          outboxRow({
            aggregateType: 'auction',
            aggregateId: result.isin,
            eventType: BOT_EVENTS.winnersChecked,
            payload: { ...result },
            dedupeKey: `${result.isin}:${result.status}:${result.callbacksTotal}:${result.winnersTotal}`,
          }),
        ],
        skipDuplicates: true,
      }),
    ]);
    // A new event means the outcome differs from every earlier one.
    return inserted.count > 0;
  }
}
