import { readFileSync } from 'node:fs';
import { Logger, type Provider } from '@nestjs/common';
import { PemRequestSigner } from '@govsec/bot-client';
import { CONFIG, type BotGatewayConfig } from '../config/configuration';
import { BotApiClient } from './bot-api.client';
import { BotTokenManager } from './bot-token.manager';
import { BotHealth } from './bot-health';
import { observers, type BotExchangeObserver } from './bot-observer';
import { BotApiError, BotTransport } from './bot-transport';
import { PrismaAuditWriter } from './prisma-audit.writer';
import { BotService } from './bot.service';

const logger = new Logger('BotConnection');

/**
 * Builds the BoT client from configuration.
 *
 * Missing credentials do not stop the service from booting — a developer working on
 * something else should not need BoT keys — but every BoT call then fails with
 * NOT_CONFIGURED, loudly. Production refuses to boot without them (configuration.ts).
 *
 * The signer reads a PEM key file, which is right for development and the BoT sandbox.
 * Production signs inside the HSM behind the same RequestSigner interface (TAD §10.1).
 */
export function buildBotService(
  bot: BotGatewayConfig['bot'],
  observer?: BotExchangeObserver,
  health?: BotHealth,
): BotService {
  const required = {
    BOT_API_KEY: bot.apiKey,
    BOT_INTERFACE_CODE: bot.interfaceCode,
    BOT_SENDER_CODE: bot.senderCode,
    BOT_USERNAME: bot.username,
    BOT_PRIVATE_KEY_PATH: bot.privateKeyPath,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    logger.warn(
      `BoT connection not configured (missing ${missing.join(', ')}); BoT calls will fail`,
    );
    health?.setConfigured(false);
    return new BotService(notConfigured(missing));
  }
  health?.setConfigured(true);

  const signer = new PemRequestSigner(readFileSync(bot.privateKeyPath ?? '', 'utf8'));
  const transport = new BotTransport(
    {
      baseUrl: bot.baseUrl,
      apiKey: bot.apiKey ?? '',
      interfaceCode: bot.interfaceCode ?? '',
      senderCode: bot.senderCode ?? '',
      username: bot.username ?? '',
    },
    signer,
    { observer },
  );
  logger.log(`BoT connection → ${bot.baseUrl} (${bot.environment})`);
  return new BotService(new BotApiClient(transport, new BotTokenManager(transport)));
}

function notConfigured(missing: string[]): BotApiClient {
  return {
    call: async () => {
      throw new BotApiError(
        0,
        'NOT_CONFIGURED',
        `BoT connection not configured: ${missing.join(', ')}`,
        '',
      );
    },
  } as unknown as BotApiClient;
}

export const botHealthProvider: Provider = {
  provide: BotHealth,
  useFactory: () => new BotHealth(),
};

/** Every exchange goes to the health tracker (reachability, clock) and the audit log. */
export const botServiceProvider: Provider = {
  provide: BotService,
  useFactory: (config: BotGatewayConfig, health: BotHealth, audit: PrismaAuditWriter) =>
    buildBotService(config.bot, observers(health, audit), health),
  inject: [CONFIG, BotHealth, PrismaAuditWriter],
};
