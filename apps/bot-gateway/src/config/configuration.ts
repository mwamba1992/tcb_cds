import { BOT_GATEWAYS, type BotEnvironment } from '@govsec/bot-client';

/** Configuration for the bot-gateway service. Validated at boot: a bad value stops the process. */

export interface BotGatewayConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwt: {
    algorithm: 'HS256' | 'RS256';
    /** Verification material only. Under RS256 this service holds no signing key. */
    accessSecret: string;
    stepUpSecret: string;
    issuer: string;
    audience: string;
  };
  rabbitmq: { url: string };
  internalSecret: string;
  outbox: { pollIntervalMs: number; batchSize: number };
  bot: {
    environment: BotEnvironment;
    baseUrl: string;
    /** Assigned by BoT at onboarding. Absent in local development. */
    apiKey?: string;
    interfaceCode?: string;
    senderCode?: string;
    username?: string;
    /** The 8-character code that prefixes every batch reference. */
    participantCode?: string;
    /** TCB's RSA private key (development and sandbox only; production signs in the HSM). */
    privateKeyPath?: string;
    /** BoT's public key, for verifying callbacks. */
    botPublicKeyPath?: string;
    /** How often to poll GET /auctions, in ms; 0 disables the sync. */
    auctionSyncMs: number;
    /** How often to check submitted batches against GET /bids, in ms; 0 disables. */
    reconcileMs: number;
    /** How often to cross-check allotments against /winners, in ms; 0 disables. */
    winnersCheckMs: number;
    /** The name BoT shows for TCB as `investor` on /winners (Appendix B, B1). */
    investorName: string;
  };
}

class ConfigError extends Error {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new ConfigError(`${name} is required but was not set`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new ConfigError(`${name} must be a number, got "${raw}"`);
  return parsed;
}

export function loadConfig(): BotGatewayConfig {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const rs256 = (process.env['JWT_ALGORITHM'] ?? 'HS256') === 'RS256';

  const config: BotGatewayConfig = {
    nodeEnv,
    port: optionalNumber('BOT_GATEWAY_PORT', 3104),
    databaseUrl: required('BOT_GATEWAY_DATABASE_URL'),
    jwt: {
      algorithm: rs256 ? 'RS256' : 'HS256',
      accessSecret: rs256 ? required('JWT_PUBLIC_KEY') : required('JWT_ACCESS_SECRET'),
      stepUpSecret: rs256 ? required('JWT_PUBLIC_KEY') : required('JWT_STEP_UP_SECRET'),
      issuer: optional('JWT_ISSUER') ?? 'govsec-identity',
      audience: optional('JWT_AUDIENCE') ?? 'govsec',
    },
    rabbitmq: { url: required('RABBITMQ_URL') },
    internalSecret: required('INTERNAL_SERVICE_SECRET'),
    outbox: {
      pollIntervalMs: optionalNumber('OUTBOX_POLL_INTERVAL_MS', 1000),
      batchSize: optionalNumber('OUTBOX_BATCH_SIZE', 100),
    },
    bot: {
      environment: (optional('BOT_ENVIRONMENT') ?? 'sandbox') as BotEnvironment,
      baseUrl:
        optional('BOT_BASE_URL') ??
        BOT_GATEWAYS[(optional('BOT_ENVIRONMENT') ?? 'sandbox') as BotEnvironment],
      apiKey: optional('BOT_API_KEY'),
      interfaceCode: optional('BOT_INTERFACE_CODE'),
      senderCode: optional('BOT_SENDER_CODE'),
      username: optional('BOT_USERNAME'),
      participantCode: optional('BOT_PARTICIPANT_CODE'),
      privateKeyPath: optional('BOT_PRIVATE_KEY_PATH'),
      botPublicKeyPath: optional('BOT_PUBLIC_KEY_PATH'),
      auctionSyncMs: optionalNumber('BOT_AUCTION_SYNC_MS', 300_000),
      reconcileMs: optionalNumber('BOT_RECONCILE_MS', 60_000),
      winnersCheckMs: optionalNumber('BOT_WINNERS_CHECK_MS', 300_000),
      investorName: optional('BOT_INVESTOR_NAME') ?? 'TANZANIA COMMERCIAL BANK',
    },
  };

  if (!(config.bot.environment in BOT_GATEWAYS)) {
    throw new ConfigError(
      `BOT_ENVIRONMENT must be one of ${Object.keys(BOT_GATEWAYS).join(', ')}, got "${config.bot.environment}"`,
    );
  }

  if (nodeEnv === 'production') {
    if (!rs256) {
      throw new ConfigError('JWT_ALGORITHM must be RS256 in production (TAD §10.1)');
    }
    if (/dev-only|change-me/i.test(config.internalSecret)) {
      throw new ConfigError('INTERNAL_SERVICE_SECRET still holds a development placeholder');
    }
    for (const [key, value] of Object.entries({
      BOT_API_KEY: config.bot.apiKey,
      BOT_INTERFACE_CODE: config.bot.interfaceCode,
      BOT_SENDER_CODE: config.bot.senderCode,
      BOT_USERNAME: config.bot.username,
      BOT_PARTICIPANT_CODE: config.bot.participantCode,
      BOT_PUBLIC_KEY_PATH: config.bot.botPublicKeyPath,
    })) {
      if (!value) throw new ConfigError(`${key} is required in production`);
    }
    if (config.bot.environment !== 'production') {
      throw new ConfigError('BOT_ENVIRONMENT must be production when NODE_ENV is production');
    }
  }
  return config;
}

export const CONFIG = 'BOT_GATEWAY_CONFIG';
