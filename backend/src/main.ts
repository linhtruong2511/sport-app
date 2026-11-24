import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';
import { AppExceptionsFilter } from './core/errors.js';
import { authRateLimitMiddleware } from './core/http/rate-limit.middleware.js';
import { securityHeadersMiddleware } from './core/http/security-headers.middleware.js';
import { traceIdMiddleware } from './core/http/trace-id.middleware.js';
import { AppLogger } from './core/logger.js';
import { DatabaseService } from './database/database.service.js';

async function bootstrap() {
  const expressApp = express();
  expressApp.disable('x-powered-by');
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bodyParser: false,
  });
  const logger = app.get(AppLogger);

  app.setGlobalPrefix('api/v1');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(traceIdMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(['/api/v1/auth/login', '/api/v1/auth/register'], authRateLimitMiddleware);
  app.enableCors({ origin: env.corsOrigin, credentials: true });
  app.useGlobalFilters(new AppExceptionsFilter(logger));
  app.enableShutdownHooks();

  const db = app.get(DatabaseService);
  try {
    const info = await db.checkConnection();
    logger.info('Database connected', {
      context: 'Bootstrap',
      server: env.db.server,
      instance: info.serverName,
      database: info.databaseName,
      user: info.currentUser,
    });
  } catch (error) {
    logger.error('Failed to connect to database', {
      context: 'Bootstrap',
      server: env.db.server,
      database: env.db.database,
      err: error,
    });
    process.exit(1);
  }

  await app.listen(env.port);
  logger.info('SportHub backend listening', {
    context: 'Bootstrap',
    port: env.port,
  });
}

void bootstrap();
