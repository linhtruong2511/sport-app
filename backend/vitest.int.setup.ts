import { env } from './src/config/env.js';
import { resetDatabase } from './src/scripts/dbReset.js';

export async function setup(): Promise<void> {
  process.env.DB_DATABASE = env.db.testDatabase;
  await resetDatabase({ database: env.db.testDatabase, seedSample: true });
}
