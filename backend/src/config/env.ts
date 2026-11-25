import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export type DbAuthType = 'windows' | 'sql';

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
};

export const DEFAULT_JWT_ACCESS_SECRET = 'sporthub-dev-access-secret-change-in-prod';
export const DEFAULT_SEPAY_WEBHOOK_API_KEY = 'sporthub-dev-sepay-key';

const nodeEnv = process.env.NODE_ENV || 'development';

export interface AppEnv {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  jwtAccessSecret: string;
  jwtAccessExpiresIn: string;
  refreshTokenDays: number;
  cookieSecure: boolean;
  sepayWebhookApiKey: string;
  sepayApiUrl: string;
  sepayApiToken: string;
  db: {
    authType: DbAuthType;
    server: string;
    database: string;
    testDatabase: string;
    odbcDriver: string;
    trustServerCertificate: boolean;
    encrypt: boolean;
    user: string;
    password: string;
    port: number | undefined;
  };
}

export function resolveCorsOrigin(corsOriginValue: string): string | string[] {
  const parts = corsOriginValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (parts.length <= 1) {
    return parts[0] ?? 'http://localhost:5173';
  }
  return parts;
}

export function validateProductionEnv(rawEnv: NodeJS.ProcessEnv, parsed: AppEnv): void {
  if (parsed.nodeEnv !== 'production') {
    return;
  }

  const errors: string[] = [];
  const rawJwtSecret = rawEnv.JWT_ACCESS_SECRET?.trim() ?? '';
  if (!rawJwtSecret || rawJwtSecret === DEFAULT_JWT_ACCESS_SECRET || rawJwtSecret.length < 32) {
    errors.push(
      'JWT_ACCESS_SECRET must be explicitly set to a strong secret (>= 32 chars, not the dev default) in production.',
    );
  }

  const rawSepayKey = rawEnv.SEPAY_WEBHOOK_API_KEY?.trim() ?? '';
  if (!rawSepayKey || rawSepayKey === DEFAULT_SEPAY_WEBHOOK_API_KEY) {
    errors.push(
      'SEPAY_WEBHOOK_API_KEY must be explicitly set (not the dev default) in production.',
    );
  }

  const rawDbServer = rawEnv.DB_SERVER?.trim() ?? '';
  if (!rawDbServer) {
    errors.push('DB_SERVER must be explicitly set in production.');
  }

  if (parsed.db.authType === 'sql') {
    if (!(rawEnv.DB_USER?.trim() ?? '')) {
      errors.push('DB_USER must be set when DB_AUTH_TYPE=sql in production.');
    }
    if (!(rawEnv.DB_PASSWORD?.trim() ?? '')) {
      errors.push('DB_PASSWORD must be set when DB_AUTH_TYPE=sql in production.');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production environment configuration:\n- ${errors.join('\n- ')}`);
  }
}

export const env: AppEnv = {
  port: Number(process.env.PORT || 3000),
  nodeEnv,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || DEFAULT_JWT_ACCESS_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, nodeEnv === 'production'),
  sepayWebhookApiKey: process.env.SEPAY_WEBHOOK_API_KEY || DEFAULT_SEPAY_WEBHOOK_API_KEY,
  sepayApiUrl: process.env.SEPAY_API_URL || 'https://my.sepay.vn/userapi',
  sepayApiToken: process.env.SEPAY_API_TOKEN || '',
  db: {
    authType: (process.env.DB_AUTH_TYPE === 'sql' ? 'sql' : 'windows') as DbAuthType,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'SportHub',
    testDatabase: process.env.DB_TEST_DATABASE || 'SportHub_Test',
    odbcDriver: process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server',
    trustServerCertificate: parseBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    encrypt: parseBoolean(process.env.DB_ENCRYPT, false),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  },
};

validateProductionEnv(process.env, env);
