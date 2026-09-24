import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@govsec/auth';
import { BotHealth } from '../bot/bot-health';
import { PrismaService } from '../prisma/prisma.service';

/** Liveness must not touch dependencies; readiness must. */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: BotHealth,
  ) {}

  @Public()
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe' })
  liveness() {
    return { status: 'ok', service: 'bot-gateway' };
  }

  @Public()
  @Get('readyz')
  @ApiOperation({ summary: 'Readiness probe' })
  async readiness() {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    // BoT's state is reported, not gated on: bot-gateway must stay ready to receive
    // BoT's callbacks even while its own calls to BoT are failing.
    const bot = this.bot.snapshot();
    return {
      status:
        database === 'up'
          ? bot.reachable && bot.clockOk
            ? 'ready'
            : 'ready-degraded'
          : 'degraded',
      database,
      bot,
    };
  }
}
