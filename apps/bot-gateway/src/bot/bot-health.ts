import { Logger } from '@nestjs/common';
import { BOT_TIMESTAMP_TOLERANCE_SECONDS } from '@govsec/bot-client';
import type { BotExchange, BotExchangeObserver } from './bot-observer';

/**
 * What bot-gateway knows about its link to BoT, for /readyz and for the logs.
 *
 * Clock skew matters more here than almost anywhere: BoT refuses any request whose
 * x-timestamp is more than 300 seconds from its own clock, and it would start
 * refusing all of them at once — plausibly at cut-off. The skew is measured on every
 * exchange from BoT's Date header, and a warning is raised well inside the limit
 * (at a fifth of it) so there is time to fix the server's time sync first.
 */

export const SKEW_WARNING_SECONDS = BOT_TIMESTAMP_TOLERANCE_SECONDS / 5;

export interface BotHealthSnapshot {
  configured: boolean;
  /** Last exchange succeeded (or none attempted yet with nothing failing). */
  reachable: boolean;
  lastSuccessAt: string | null;
  lastFailure: { at: string; status: number; code: string | null } | null;
  consecutiveFailures: number;
  clockSkewSeconds: number | null;
  clockOk: boolean;
}

export class BotHealth implements BotExchangeObserver {
  private readonly logger = new Logger('BotHealth');
  private configured = false;
  private lastSuccessAt: Date | null = null;
  private lastFailure: { at: Date; status: number; code: string | null } | null = null;
  private consecutiveFailures = 0;
  private skew: number | null = null;
  private skewWarned = false;

  setConfigured(configured: boolean): void {
    this.configured = configured;
  }

  onExchange(exchange: BotExchange): void {
    if (exchange.clockSkewSeconds !== null) this.recordSkew(exchange.clockSkewSeconds);

    // A 4xx is BoT answering; the link is fine even if the request was not.
    const linkUp = exchange.status > 0 && exchange.status < 500;
    if (linkUp) {
      if (this.consecutiveFailures > 0) {
        this.logger.log(`BoT reachable again after ${this.consecutiveFailures} failures`);
      }
      this.lastSuccessAt = exchange.at;
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
      this.lastFailure = { at: exchange.at, status: exchange.status, code: exchange.errorCode };
      if (this.consecutiveFailures === 1 || this.consecutiveFailures % 10 === 0) {
        this.logger.warn(
          `BoT ${exchange.status === 0 ? 'unreachable' : `answered ${exchange.status}`} on ` +
            `${exchange.method} ${exchange.path} (${this.consecutiveFailures} in a row)`,
        );
      }
    }
  }

  snapshot(): BotHealthSnapshot {
    return {
      configured: this.configured,
      reachable: this.consecutiveFailures === 0,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
      lastFailure: this.lastFailure
        ? {
            at: this.lastFailure.at.toISOString(),
            status: this.lastFailure.status,
            code: this.lastFailure.code,
          }
        : null,
      consecutiveFailures: this.consecutiveFailures,
      clockSkewSeconds: this.skew,
      clockOk: this.skew === null || Math.abs(this.skew) < SKEW_WARNING_SECONDS,
    };
  }

  private recordSkew(seconds: number): void {
    this.skew = seconds;
    const drifting = Math.abs(seconds) >= SKEW_WARNING_SECONDS;
    if (drifting && !this.skewWarned) {
      this.logger.warn(
        `Clock differs from BoT's by ${seconds}s. BoT refuses requests beyond ` +
          `${BOT_TIMESTAMP_TOLERANCE_SECONDS}s: check this server's time sync (NTP) now.`,
      );
    } else if (!drifting && this.skewWarned) {
      this.logger.log(`Clock back within ${SKEW_WARNING_SECONDS}s of BoT's (${seconds}s)`);
    }
    this.skewWarned = drifting;
  }
}
