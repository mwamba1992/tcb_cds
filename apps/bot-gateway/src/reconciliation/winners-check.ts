import { Money } from '@govsec/money';
import type { BotWinnersCheckedPayload } from '@govsec/events';
import type { BotService } from '../bot/bot.service';

/**
 * Cross-checks allotments against BoT's /winners (TAD §7.4).
 *
 * Callbacks tell us, bid by bid, what BoT allotted. /winners should list the same
 * allotments, but without accounts or requestIds (Appendix B, B1), so it cannot be
 * matched bid by bid. What it can confirm is the total: the face value allotted to
 * TCB on /winners must equal the sum of the allotment callbacks. A difference means a
 * callback was lost, duplicated or wrong, and is raised as a break.
 *
 * TCB's rows on /winners are recognised by the `investor` name BoT shows for TCB
 * (BOT_INVESTOR_NAME) — the only identifier the schema offers.
 */

export interface WinnersCandidate {
  isin: string;
  /** Sum of allotted face value from callbacks, decimal string. */
  callbacksTotal: string;
}

export interface WinnersStore {
  /** ISINs with allotment callbacks whose totals are not yet confirmed. */
  candidates(): Promise<WinnersCandidate[]>;
  /** Saves the result; true when it differs from the last one. */
  save(result: BotWinnersCheckedPayload): Promise<boolean>;
}

export type WinnersOutcome = BotWinnersCheckedPayload & { changed: boolean };

export class WinnersCheck {
  private running = false;

  constructor(
    private readonly bot: BotService,
    private readonly store: WinnersStore,
    private readonly investorName: string,
  ) {}

  async runOnce(): Promise<WinnersOutcome[] | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const results: WinnersOutcome[] = [];
      for (const candidate of await this.store.candidates()) {
        results.push(await this.check(candidate));
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  async check(candidate: WinnersCandidate): Promise<WinnersOutcome> {
    const { winners } = await this.bot.getWinners(candidate.isin);
    const ours = winners.filter(
      (w) => (w.investor ?? '').trim().toUpperCase() === this.investorName.trim().toUpperCase(),
    );
    const winnersTotal = ours.reduce(
      (total, w) => total.add(Money.parse(w.faceValue, 'TZS')),
      Money.zero('TZS'),
    );
    const callbacksTotal = Money.parse(candidate.callbacksTotal, 'TZS');
    const result: BotWinnersCheckedPayload = {
      isin: candidate.isin,
      status: winnersTotal.equals(callbacksTotal) ? 'matched' : 'break',
      callbacksTotal: callbacksTotal.toString(),
      winnersTotal: winnersTotal.toString(),
    };
    const changed = await this.store.save(result);
    return { ...result, changed };
  }
}
