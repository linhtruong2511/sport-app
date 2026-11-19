import dotenv from 'dotenv';

dotenv.config();

export type DbAuthType = 'windows' | 'sql';

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
};

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  db: {
    authType: (process.env.DB_AUTH_TYPE === 'sql' ? 'sql' : 'windows') as DbAuthType,
    server: process.env.DB_SERVER || 'LINHTRUONG\\SQLEXPRESS',
    database: process.env.DB_DATABASE || 'SportApp',
    odbcDriver: process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server',
    trustServerCertificate: parseBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    encrypt: parseBoolean(process.env.DB_ENCRYPT, false),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  },
};
