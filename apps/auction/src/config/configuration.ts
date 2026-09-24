/** Configuration for the auction service. Validated at boot: a bad value stops the process. */

export interface AuctionConfig {
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
  services: {
    identityUrl: string;
    investorUrl: string;
    cbsGatewayUrl: string;
    botGatewayUrl: string;
    notificationUrl: string;
  };
  bidding: {
    /** BoT's closing time on auction day, HH:MM EAT. BoT has not published it (Appendix B4). */
    botCloseTime: string;
    /** TCB closes bidding this many hours before BoT, for maker-checker and submission. */
    cutoffHoursBeforeBot: number;
    /** Commission in basis points of face value; held with the bid. */
    commissionBps: number;
    minimumBill: number;
    minimumBond: number;
    bidMultiple: number;
  };
  /** BoT participant code, for batch references. */
  participantCode: string;
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

export function loadConfig(): AuctionConfig {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const rs256 = (process.env['JWT_ALGORITHM'] ?? 'HS256') === 'RS256';

  const config: AuctionConfig = {
    nodeEnv,
    port: optionalNumber('AUCTION_PORT', 3103),
    databaseUrl: required('AUCTION_DATABASE_URL'),
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
    services: {
      identityUrl: optional('IDENTITY_URL') ?? 'http://localhost:3101',
      investorUrl: optional('INVESTOR_URL') ?? 'http://localhost:3102',
      cbsGatewayUrl: optional('CBS_GATEWAY_URL') ?? 'http://localhost:3105',
      botGatewayUrl: optional('BOT_GATEWAY_URL') ?? 'http://localhost:3104',
      notificationUrl: optional('NOTIFICATION_URL') ?? 'http://localhost:3107',
    },
    bidding: {
      botCloseTime: optional('BOT_AUCTION_CLOSE_TIME') ?? '10:00',
      cutoffHoursBeforeBot: optionalNumber('TCB_CUTOFF_HOURS_BEFORE_BOT', 3),
      commissionBps: optionalNumber('BID_COMMISSION_BPS', 0),
      minimumBill: optionalNumber('BID_MINIMUM_BILL', 500_000),
      minimumBond: optionalNumber('BID_MINIMUM_BOND', 1_000_000),
      bidMultiple: optionalNumber('BID_MULTIPLE', 100_000),
    },
    participantCode: required('BOT_PARTICIPANT_CODE'),
  };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.bidding.botCloseTime)) {
    throw new ConfigError('BOT_AUCTION_CLOSE_TIME must be HH:MM (EAT)');
  }
  if (config.bidding.minimumBill < 500_000) {
    throw new ConfigError('BID_MINIMUM_BILL cannot be below BoT\'s TZS 500,000 minimum');
  }
  if (!/^[A-Z0-9]{8}$/.test(config.participantCode)) {
    throw new ConfigError('BOT_PARTICIPANT_CODE must be 8 letters or digits');
  }

  if (nodeEnv === 'production') {
    if (!rs256) {
      throw new ConfigError('JWT_ALGORITHM must be RS256 in production (TAD §10.1)');
    }
    if (/dev-only|change-me/i.test(config.internalSecret)) {
      throw new ConfigError('INTERNAL_SERVICE_SECRET still holds a development placeholder');
    }
  }
  return config;
}

export const CONFIG = 'AUCTION_CONFIG';
