import { checkDatabaseConnection, closePool } from '../config/database.js';
import { env } from '../config/env.js';

async function main() {
  console.log(`Testing SQL Server connection to ${env.db.server} (DB: ${env.db.database}, Auth: ${env.db.authType})...`);
  try {
    const info = await checkDatabaseConnection();
    console.log('Connection successful!');
    console.log({
      serverName: info.serverName,
      databaseName: info.databaseName,
      currentUser: info.currentUser,
      serverTime: info.serverTime,
      sqlVersion: info.sqlVersion.split('\n')[0],
    });
  } catch (error) {
    console.error('Connection failed:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

void main();
