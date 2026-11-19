import { createRequire } from 'node:module';
import type sqlTypes from 'mssql';
import { env } from './env.js';

const require = createRequire(import.meta.url);

// Use msnodesqlv8 driver for Windows Authentication (Integrated Security),
// or default tedious driver for SQL Server Login authentication.
const sql: typeof sqlTypes =
  env.db.authType === 'windows' ? require('mssql/msnodesqlv8') : require('mssql');

let poolPromise: Promise<sqlTypes.ConnectionPool> | null = null;

function buildConfig(): sqlTypes.config {
  const poolOptions = {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  };

  if (env.db.authType === 'windows') {
    const connectionString = [
      `Driver={${env.db.odbcDriver}}`,
      `Server=${env.db.server}`,
      `Database=${env.db.database}`,
      'Trusted_Connection=Yes',
      `TrustServerCertificate=${env.db.trustServerCertificate ? 'Yes' : 'No'}`,
      `Encrypt=${env.db.encrypt ? 'Yes' : 'No'}`,
    ].join(';');

    return {
      connectionString,
      driver: 'msnodesqlv8',
      pool: poolOptions,
    } as unknown as sqlTypes.config;
  }

  const [host, instanceName] = env.db.server.split('\\');
  return {
    server: host,
    database: env.db.database,
    user: env.db.user,
    password: env.db.password,
    port: instanceName ? undefined : env.db.port,
    pool: poolOptions,
    options: {
      instanceName,
      encrypt: env.db.encrypt,
      trustServerCertificate: env.db.trustServerCertificate,
    },
  };
}

export async function getPool(): Promise<sqlTypes.ConnectionPool> {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(buildConfig());
    poolPromise = pool.connect().catch((err: unknown) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export interface DbConnectionInfo {
  serverName: string;
  databaseName: string;
  currentUser: string;
  sqlVersion: string;
  serverTime: Date;
}

export async function checkDatabaseConnection(): Promise<DbConnectionInfo> {
  const pool = await getPool();
  const result = await pool.request().query<{
    serverName: string;
    databaseName: string;
    currentUser: string;
    sqlVersion: string;
    serverTime: Date;
  }>(`
    SELECT
      @@SERVERNAME AS serverName,
      DB_NAME() AS databaseName,
      SYSTEM_USER AS currentUser,
      @@VERSION AS sqlVersion,
      GETDATE() AS serverTime
  `);

  return result.recordset[0];
}

export async function closePool(): Promise<void> {
  if (!poolPromise) return;
  try {
    const pool = await poolPromise;
    await pool.close();
  } finally {
    poolPromise = null;
  }
}

export { sql };
