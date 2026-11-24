import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPoolForDatabase, sql } from '../config/database.js';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');

const SESSION_SET_OPTIONS = `
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
`;

export function splitSqlBatches(sqlText: string): string[] {
  const normalized = sqlText.replace(/^\uFEFF/, '');
  return normalized
    .split(/^\s*GO\s*(?:--.*)?$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);
}

export async function runMigrations(databaseName = env.db.database): Promise<string[]> {
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Invalid database name: ${databaseName}`);
  }

  const pool = await createPoolForDatabase(databaseName, 1);
  const applied: string[] = [];

  try {
    await pool.request().query(`
      ${SESSION_SET_OPTIONS}
      IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
      BEGIN
          CREATE TABLE dbo.SchemaMigrations (
              Version   VARCHAR(100) NOT NULL,
              AppliedAt DATETIME2(0) NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAt DEFAULT (SYSDATETIME()),
              CONSTRAINT PK_SchemaMigrations PRIMARY KEY (Version)
          );
      END;
    `);

    const existingResult = await pool.request().query<{ Version: string }>(
      'SELECT Version FROM dbo.SchemaMigrations',
    );
    const existingVersions = new Set(existingResult.recordset.map((row) => row.Version));

    const entries = await readdir(MIGRATIONS_DIR);
    const migrationFiles = entries
      .filter((file) => file.toLowerCase().endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const file of migrationFiles) {
      if (existingVersions.has(file)) {
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sqlText = await readFile(filePath, 'utf8');
      const batches = splitSqlBatches(sqlText);

      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx).query(SESSION_SET_OPTIONS);
        for (const batch of batches) {
          await new sql.Request(tx).query(batch);
        }
        await new sql.Request(tx)
          .input('version', sql.VarChar(100), file)
          .query('INSERT INTO dbo.SchemaMigrations (Version) VALUES (@version)');
        await tx.commit();
        applied.push(file);
      } catch (err) {
        await tx.rollback().catch(() => undefined);
        throw err;
      }
    }
  } finally {
    await pool.close();
  }

  return applied;
}

function parseDbArg(argv: string[]): string | undefined {
  const arg = argv.find((item) => item.startsWith('--db='));
  return arg ? arg.slice('--db='.length) : undefined;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMain) {
  const targetDb = parseDbArg(process.argv.slice(2)) || env.db.database;
  runMigrations(targetDb)
    .then((applied) => {
      console.log(
        applied.length > 0
          ? `Applied ${applied.length} migration(s) to ${targetDb}: ${applied.join(', ')}`
          : `No pending migrations for ${targetDb}.`,
      );
    })
    .catch((err: unknown) => {
      console.error('Migration failed:', err);
      process.exitCode = 1;
    });
}
