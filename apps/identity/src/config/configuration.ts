/** Configuration for the identity service. Validated at boot: a bad value stops the process. */

export interface IdentityConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwt: {
    algorithm: 'HS256' | 'RS256';
    /** Verification material: the HS256 secret, or the RS256 public key. */
    accessSecret: string;
    stepUpSecret: string;
    /** RS256 only. Identity is the one service that holds it. */
    privateKey: string;
    /** Refresh tokens never leave Identity, so they stay on a symmetric secret. */
    refreshSecret: string;
    accessTtl: Duration;
    refreshTtl: Duration;
    stepUpTtl: Duration;
    issuer: string;
    audience: string;
  };
  otp: {
    ttlSeconds: number;
    maxAttempts: number;
    /** Minimum gap between two codes to the same number. */
    resendSeconds: number;
    /** Codes to one number per rolling hour, all purposes. */
    maxPerHour: number;
    /** Development only: every code is this value. Refused in production. */
    fixedCode: string | null;
  };
  pin: { maxAttempts: number };
  notificationUrl: string;
  rabbitmq: { url: string };
  internalSecret: string;
  outbox: { pollIntervalMs: number; batchSize: number };
}

export type Duration = `${number}${'s' | 'm' | 'h' | 'd'}`;

const DURATION_PATTERN = /^[1-9]\d*[smhd]$/;
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export class ConfigError extends Error {
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

function optionalDuration(name: string, fallback: Duration): Duration {
  const raw = optional(name) ?? fallback;
  if (!DURATION_PATTERN.test(raw)) {
    throw new ConfigError(`${name} must look like 15m, 12h or 30d, got "${raw}"`);
  }
  return raw as Duration;
}

export function durationMs(duration: Duration): number {
  if (!DURATION_PATTERN.test(duration)) {
    throw new ConfigError(`Cannot read "${duration}" as a duration`);
  }
  return Number(duration.slice(0, -1)) * (UNIT_MS[duration.slice(-1)] ?? 0);
}

export function loadConfig(): IdentityConfig {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const rs256 = (process.env['JWT_ALGORITHM'] ?? 'HS256') === 'RS256';

  const config: IdentityConfig = {
    nodeEnv,
    port: optionalNumber('IDENTITY_PORT', 3101),
    databaseUrl: required('IDENTITY_DATABASE_URL'),
    jwt: {
      algorithm: rs256 ? 'RS256' : 'HS256',
      accessSecret: rs256 ? required('JWT_PUBLIC_KEY') : required('JWT_ACCESS_SECRET'),
      stepUpSecret: rs256 ? required('JWT_PUBLIC_KEY') : required('JWT_STEP_UP_SECRET'),
      privateKey: rs256 ? required('JWT_PRIVATE_KEY') : '',
      refreshSecret: required('JWT_REFRESH_SECRET'),
      accessTtl: optionalDuration('ACCESS_TOKEN_TTL', '15m'),
      refreshTtl: optionalDuration('REFRESH_TOKEN_TTL', '12h'),
      stepUpTtl: optionalDuration('STEP_UP_TOKEN_TTL', '5m'),
      issuer: optional('JWT_ISSUER') ?? 'govsec-identity',
      audience: optional('JWT_AUDIENCE') ?? 'govsec',
    },
    otp: {
      ttlSeconds: optionalNumber('OTP_TTL_SECONDS', 300),
      maxAttempts: optionalNumber('OTP_MAX_ATTEMPTS', 5),
      resendSeconds: optionalNumber('OTP_RESEND_SECONDS', 60),
      maxPerHour: optionalNumber('OTP_MAX_PER_HOUR', 5),
      fixedCode: optional('OTP_FIXED_CODE') ?? null,
    },
    pin: { maxAttempts: optionalNumber('PIN_MAX_ATTEMPTS', 5) },
    notificationUrl: optional('NOTIFICATION_URL') ?? 'http://localhost:3107',
    rabbitmq: { url: required('RABBITMQ_URL') },
    internalSecret: required('INTERNAL_SERVICE_SECRET'),
    outbox: {
      pollIntervalMs: optionalNumber('OUTBOX_POLL_INTERVAL_MS', 1000),
      batchSize: optionalNumber('OUTBOX_BATCH_SIZE', 100),
    },
  };

  if (config.otp.fixedCode !== null && !/^\d{6}$/.test(config.otp.fixedCode)) {
    throw new ConfigError('OTP_FIXED_CODE must be six digits');
  }
  if (config.jwt.refreshSecret === config.jwt.accessSecret) {
    throw new ConfigError('JWT_REFRESH_SECRET must differ from the access-token key');
  }

  if (nodeEnv === 'production') {
    if (!rs256) {
      throw new ConfigError('JWT_ALGORITHM must be RS256 in production (TAD §10.1)');
    }
    if (/dev-only|change-me/i.test(config.internalSecret)) {
      throw new ConfigError('INTERNAL_SERVICE_SECRET still holds a development placeholder');
    }
    if (/dev-only|change-me/i.test(config.jwt.refreshSecret)) {
      throw new ConfigError('JWT_REFRESH_SECRET still holds a development placeholder');
    }
    if (config.otp.fixedCode !== null) {
      throw new ConfigError('OTP_FIXED_CODE must not be set in production');
    }
  }
  return config;
}

export const CONFIG = 'IDENTITY_CONFIG';
