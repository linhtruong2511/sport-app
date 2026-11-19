import { createApp } from './app.js';
import { checkDatabaseConnection, closePool } from './config/database.js';
import { env } from './config/env.js';

async function bootstrap() {
  try {
    const dbInfo = await checkDatabaseConnection();
    console.log(
      `[DB] Connected to ${env.db.server} (instance: ${dbInfo.serverName}, db: ${dbInfo.databaseName}, user: ${dbInfo.currentUser})`,
    );
  } catch (error) {
    console.error(`[DB] Failed to connect to ${env.db.server}/${env.db.database}:`, error);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[Server] SportApp backend listening on http://localhost:${env.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}, shutting down...`);
    server.close(async () => {
      await closePool();
      console.log('[DB] Connection pool closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
