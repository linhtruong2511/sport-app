import { describe, expect, it } from 'vitest';
import {
  type AppEnv,
  DEFAULT_JWT_ACCESS_SECRET,
  DEFAULT_SEPAY_WEBHOOK_API_KEY,
  resolveCorsOrigin,
  validateProductionEnv,
} from '../env.js';

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    port: 3000,
    nodeEnv: 'production',
    corsOrigin: 'https://sporthub.vn',
    jwtAccessSecret: 'a-very-strong-production-jwt-secret-key-32chars',
    jwtAccessExpiresIn: '15m',
    refreshTokenDays: 7,
    cookieSecure: true,
    sepayWebhookApiKey: 'prod-sepay-webhook-key-987654',
    sepayApiUrl: 'https://my.sepay.vn/userapi',
    sepayApiToken: 'prod-token',
    db: {
      authType: 'sql',
      server: 'db.sporthub.internal',
      database: 'SportHub',
      testDatabase: 'SportHub_Test',
      odbcDriver: 'ODBC Driver 17 for SQL Server',
      trustServerCertificate: true,
      encrypt: true,
      user: 'sporthub_app',
      password: 'StrongDbPassword!123',
      port: 1433,
    },
    ...overrides,
  };
}

describe('config/env production guards (C-2)', () => {
  it('allows dev defaults when nodeEnv is development or test', () => {
    const devEnv = makeEnv({ nodeEnv: 'development' });
    expect(() => validateProductionEnv({}, devEnv)).not.toThrow();

    const testEnv = makeEnv({ nodeEnv: 'test' });
    expect(() => validateProductionEnv({}, testEnv)).not.toThrow();
  });

  it('passes when all production secrets and SQL credentials are properly set', () => {
    const prodEnv = makeEnv();
    const rawEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: prodEnv.jwtAccessSecret,
      SEPAY_WEBHOOK_API_KEY: prodEnv.sepayWebhookApiKey,
      DB_SERVER: prodEnv.db.server,
      DB_USER: prodEnv.db.user,
      DB_PASSWORD: prodEnv.db.password,
    };
    expect(() => validateProductionEnv(rawEnv, prodEnv)).not.toThrow();
  });

  it('throws in production when JWT_ACCESS_SECRET is missing, default, or < 32 chars', () => {
    const prodEnv = makeEnv();
    const baseRaw: NodeJS.ProcessEnv = {
      SEPAY_WEBHOOK_API_KEY: 'prod-sepay-key-1234',
      DB_SERVER: 'localhost',
      DB_USER: 'sa',
      DB_PASSWORD: 'SecretPassword!1',
    };

    expect(() => validateProductionEnv(baseRaw, prodEnv)).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateProductionEnv({ ...baseRaw, JWT_ACCESS_SECRET: DEFAULT_JWT_ACCESS_SECRET }, prodEnv),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateProductionEnv({ ...baseRaw, JWT_ACCESS_SECRET: 'short-secret' }, prodEnv),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws in production when SEPAY_WEBHOOK_API_KEY is missing or default, or DB credentials are missing', () => {
    const prodEnv = makeEnv();
    const validJwt = 'prod-jwt-secret-with-at-least-32-characters-long';

    expect(() =>
      validateProductionEnv(
        {
          JWT_ACCESS_SECRET: validJwt,
          SEPAY_WEBHOOK_API_KEY: DEFAULT_SEPAY_WEBHOOK_API_KEY,
          DB_SERVER: 'localhost',
          DB_USER: 'sa',
          DB_PASSWORD: 'SecretPassword!1',
        },
        prodEnv,
      ),
    ).toThrow(/SEPAY_WEBHOOK_API_KEY/);

    expect(() =>
      validateProductionEnv(
        {
          JWT_ACCESS_SECRET: validJwt,
          SEPAY_WEBHOOK_API_KEY: 'prod-sepay-key',
          DB_SERVER: 'localhost',
          DB_USER: 'sa',
          DB_PASSWORD: '',
        },
        prodEnv,
      ),
    ).toThrow(/DB_PASSWORD/);
  });

  it('resolves single or comma-separated CORS origins cleanly', () => {
    expect(resolveCorsOrigin('https://sporthub.vn')).toBe('https://sporthub.vn');
    expect(resolveCorsOrigin('https://a.vn, https://b.vn ')).toEqual([
      'https://a.vn',
      'https://b.vn',
    ]);
  });
});
