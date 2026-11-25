import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoolForDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { runMigrations, splitSqlBatches } from './dbMigrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INIT_SCRIPT_PATH = path.resolve(__dirname, '../../../database/sporthub_init.sql');

export interface ResetDatabaseOptions {
  database?: string;
  seedSample?: boolean;
  force?: boolean;
}

const SAFE_AUTO_RESET_DB_NAMES = new Set(['SportHub_Test', 'SportHub_Dev', 'SportApp']);

function isSafeAutoResetDatabase(databaseName: string): boolean {
  return (
    SAFE_AUTO_RESET_DB_NAMES.has(databaseName) ||
    /^(SportHub|SportApp)_(Test|Dev)$/i.test(databaseName)
  );
}

function stripSqlComments(sqlText: string): string {
  return sqlText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '')
    .trim();
}

export async function resetDatabase(options?: ResetDatabaseOptions): Promise<void> {
  const targetDb = options?.database || env.db.database;
  const seedSample = options?.seedSample ?? true;
  const force = options?.force ?? false;

  if (!/^[A-Za-z0-9_]+$/.test(targetDb)) {
    throw new Error(`Invalid database name: ${targetDb}`);
  }

  if (env.nodeEnv === 'production' && !force) {
    throw new Error(
      `Refusing to reset database "${targetDb}" when NODE_ENV=production without --force-i-know.`,
    );
  }

  if (!isSafeAutoResetDatabase(targetDb) && !force) {
    throw new Error(
      `Refusing to reset database "${targetDb}" (not in test/dev whitelist) without --force-i-know.`,
    );
  }

  let sqlText = await readFile(INIT_SCRIPT_PATH, 'utf8');
  sqlText = sqlText
    .replace(/N'SportHub'/g, `N'${targetDb}'`)
    .replace(/CREATE DATABASE SportHub\b/g, `CREATE DATABASE [${targetDb}]`)
    .replace(/USE SportHub;/g, `USE [${targetDb}];`)
    .replace(/DECLARE @AllowReset BIT = 0;/g, 'DECLARE @AllowReset BIT = 1;');

  if (!seedSample) {
    sqlText = sqlText.replace(/DECLARE @SeedSample BIT = 1;/g, 'DECLARE @SeedSample BIT = 0;');
  }

  const allBatches = splitSqlBatches(sqlText);
  const createDbBatch = allBatches.find((batch) =>
    /\bCREATE\s+DATABASE\b/i.test(stripSqlComments(batch)),
  );
  const remainingBatches = allBatches.filter((batch) => {
    const stripped = stripSqlComments(batch);
    if (!stripped) return false;
    if (/^USE\s+(?:master|\[?[A-Za-z0-9_]+\]?)\s*;?$/i.test(stripped)) return false;
    if (/\bCREATE\s+DATABASE\b/i.test(stripped)) return false;
    return true;
  });

  // Step 1: Ensure target database exists from master
  if (createDbBatch) {
    const masterPool = await createPoolForDatabase('master', 1);
    try {
      await masterPool.request().query(createDbBatch);
    } finally {
      await masterPool.close();
    }
  }

  // Step 2: Connect directly to targetDb so sp_reset_connection never reverts USE <targetDb>
  const dbPool = await createPoolForDatabase(targetDb, 1);
  try {
    await dbPool.request().query(`
      DROP TABLE IF EXISTS dbo.IdempotencyKeys;
      DROP TABLE IF EXISTS dbo.SchemaMigrations;
    `);
    for (const batch of remainingBatches) {
      await dbPool.request().query(batch);
    }
  } finally {
    await dbPool.close();
  }

  // Step 3: Run pending migrations
  await runMigrations(targetDb);
}

function parseCliArgs(argv: string[]): ResetDatabaseOptions {
  const dbArg = argv.find((item) => item.startsWith('--db='));
  const noSeed = argv.includes('--no-seed');
  const force = argv.includes('--force-i-know');
  return {
    database: dbArg ? dbArg.slice('--db='.length) : undefined,
    seedSample: !noSeed,
    force,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMain) {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  const targetDb = cliOptions.database || env.db.database;
  resetDatabase(cliOptions)
    .then(() => {
      console.log(`Database ${targetDb} reset and migrated successfully (seedSample=${cliOptions.seedSample}).`);
    })
    .catch((err: unknown) => {
      console.error(`Failed to reset database ${targetDb}:`, err);
      process.exitCode = 1;
    });
}
