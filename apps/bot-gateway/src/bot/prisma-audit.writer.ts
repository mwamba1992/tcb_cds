import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { BotExchange, BotExchangeObserver } from './bot-observer';

/**
 * Writes each BoT exchange to bot_request_log.
 *
 * Fire-and-forget: the BoT call has already happened by the time this runs, and a
 * slow or failed log write must never hold it up or fail it. A failed write is logged.
 */
@Injectable()
export class PrismaAuditWriter implements BotExchangeObserver {
  private readonly logger = new Logger(PrismaAuditWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  onExchange(exchange: BotExchange): void {
    void this.prisma.botRequestLog
      .create({
        data: {
          at: exchange.at,
          method: exchange.method,
          path: exchange.path.slice(0, 200),
          status: exchange.status,
          durationMs: exchange.durationMs,
          errorCode: exchange.errorCode,
          batchReference: exchange.batchReference,
          clockSkewSec: exchange.clockSkewSeconds,
        },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Could not record BoT exchange ${exchange.method} ${exchange.path}: ` +
            (error instanceof Error ? error.message : String(error)),
        ),
      );
  }
}
