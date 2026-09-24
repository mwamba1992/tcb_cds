import { durationMs, loadConfig } from './configuration';

const BASE = {
  IDENTITY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=identity',
  JWT_ACCESS_SECRET: 'access',
  JWT_STEP_UP_SECRET: 'step-up',
  JWT_REFRESH_SECRET: 'refresh',
  RABBITMQ_URL: 'amqp://localhost',
  INTERNAL_SERVICE_SECRET: 'internal',
};

function withEnv(env: Record<string, string>, fn: () => void): void {
  const saved = process.env;
  process.env = { ...env };
  try {
    fn();
  } finally {
    process.env = saved;
  }
}

describe('identity configuration', () => {
  it('reads durations', () => {
    expect(durationMs('15m')).toBe(900_000);
    expect(durationMs('12h')).toBe(43_200_000);
  });

  it('refuses a malformed duration at boot', () => {
    withEnv({ ...BASE, ACCESS_TOKEN_TTL: 'm' }, () => {
      expect(() => loadConfig()).toThrow(/ACCESS_TOKEN_TTL/);
    });
  });

  it('refuses a refresh secret equal to the access key', () => {
    withEnv({ ...BASE, JWT_REFRESH_SECRET: 'access' }, () => {
      expect(() => loadConfig()).toThrow(/must differ/);
    });
  });

  it('refuses a fixed OTP in production', () => {
    withEnv(
      {
        ...BASE,
        NODE_ENV: 'production',
        JWT_ALGORITHM: 'RS256',
        JWT_PUBLIC_KEY: 'pub',
        JWT_PRIVATE_KEY: 'priv',
        OTP_FIXED_CODE: '123456',
      },
      () => {
        expect(() => loadConfig()).toThrow(/OTP_FIXED_CODE/);
      },
    );
  });

  it('refuses staff password sign-in in production', () => {
    withEnv(
      {
        ...BASE,
        NODE_ENV: 'production',
        JWT_ALGORITHM: 'RS256',
        JWT_PUBLIC_KEY: 'pub',
        JWT_PRIVATE_KEY: 'priv',
        STAFF_PASSWORD_LOGIN: 'true',
      },
      () => {
        expect(() => loadConfig()).toThrow(/STAFF_PASSWORD_LOGIN/);
      },
    );
  });

  it('turns staff password sign-in off by default in production', () => {
    withEnv(
      { ...BASE, NODE_ENV: 'production', JWT_ALGORITHM: 'RS256', JWT_PUBLIC_KEY: 'pub', JWT_PRIVATE_KEY: 'priv', JWT_REFRESH_SECRET: 'r' },
      () => {
        expect(loadConfig().staffPasswordLogin).toBe(false);
      },
    );
  });

  it('refuses HS256 in production', () => {
    withEnv({ ...BASE, NODE_ENV: 'production' }, () => {
      expect(() => loadConfig()).toThrow(/RS256/);
    });
  });
});
