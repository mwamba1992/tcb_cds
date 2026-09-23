/** Configuration for the settlement service. Validated at boot: a bad value stops the process. */

export interface SettlementConfig {
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

export function loadConfig(): SettlementConfig {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const rs256 = (process.env['JWT_ALGORITHM'] ?? 'HS256') === 'RS256';

  const config: SettlementConfig = {
    nodeEnv,
    port: optionalNumber('SETTLEMENT_PORT', 3106),
    databaseUrl: required('SETTLEMENT_DATABASE_URL'),
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
  };

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

export const CONFIG = 'SETTLEMENT_CONFIG';
