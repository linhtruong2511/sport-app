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

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'sporthub-dev-access-secret-change-in-prod',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, nodeEnv === 'production'),
  sepayWebhookApiKey: process.env.SEPAY_WEBHOOK_API_KEY || 'sporthub-dev-sepay-key',
  sepayApiUrl: process.env.SEPAY_API_URL || 'https://my.sepay.vn/userapi',
  sepayApiToken: process.env.SEPAY_API_TOKEN || '',
  db: {
    authType: (process.env.DB_AUTH_TYPE === 'sql' ? 'sql' : 'windows') as DbAuthType,
    server: process.env.DB_SERVER || 'LINHTRUONG\\SQLEXPRESS',
    database: process.env.DB_DATABASE || 'SportApp',
    testDatabase: process.env.DB_TEST_DATABASE || 'SportHub_Test',
    odbcDriver: process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server',
    trustServerCertificate: parseBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    encrypt: parseBoolean(process.env.DB_ENCRYPT, false),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  },
};
