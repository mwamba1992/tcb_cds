import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG, type BotGatewayConfig } from '../config/configuration';
import { SubmissionReconciler } from './submission-reconciler';
import { WinnersCheck } from './winners-check';

/**
 * Runs the two checks on their intervals (TAD §7.4):
 *
 * - submission reconciliation, every BOT_RECONCILE_MS (default one minute), so a
 *   missing bid is found with time to spare before cut-off;
 * - the winners cross-check, every BOT_WINNERS_CHECK_MS (default five minutes).
 *
 * 0 disables either. A break is logged at warn level and published as an event, once
 * when it appears or changes rather than on every run.
 */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly reconciler: SubmissionReconciler,
    private readonly winners: WinnersCheck,
    @Inject(CONFIG) private readonly config: BotGatewayConfig,
  ) {}

  onModuleInit(): void {
    this.every(this.config.bot.reconcileMs, 'Submission reconciliation', () => this.reconcile());
    this.every(this.config.bot.winnersCheckMs, 'Winners cross-check', () => this.checkWinners());
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
  }

  private every(ms: number, name: string, task: () => Promise<void>): void {
    if (ms <= 0) {
      this.logger.log(`${name} disabled`);
      return;
    }
    this.timers.push(setInterval(() => void task(), ms));
    this.logger.log(`${name} every ${Math.round(ms / 1000)}s`);
  }

  private async reconcile(): Promise<void> {
    try {
      for (const result of (await this.reconciler.runOnce()) ?? []) {
        if (result.status === 'breaks' && result.changed) {
          this.logger.warn(
            `Batch ${result.batchReference}: ${result.missing.length} missing at BoT, ` +
              `${result.unexpected.length} unexpected, ${result.rejected.length} rejected`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async checkWinners(): Promise<void> {
    try {
      for (const result of (await this.winners.runOnce()) ?? []) {
        if (result.status === 'break' && result.changed) {
          this.logger.warn(
            `Winners break on ${result.isin}: callbacks ${result.callbacksTotal}, /winners ${result.winnersTotal}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Winners check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
