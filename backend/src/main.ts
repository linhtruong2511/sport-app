import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { env } from './config/env.js';
import { DatabaseService } from './database/database.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: env.corsOrigin, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const db = app.get(DatabaseService);
  try {
    const info = await db.checkConnection();
    console.log(
      `[DB] Connected to ${env.db.server} (instance: ${info.serverName}, db: ${info.databaseName}, user: ${info.currentUser})`,
    );
  } catch (error) {
    console.error(`[DB] Failed to connect to ${env.db.server}/${env.db.database}:`, error);
    process.exit(1);
  }

  await app.listen(env.port);
  console.log(`[Server] SportApp backend listening on http://localhost:${env.port}`);
}

void bootstrap();
