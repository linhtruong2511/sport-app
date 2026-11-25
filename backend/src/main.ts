// Size libuv's threadpool above DB poolMax before any blocking msnodesqlv8 ODBC work starts.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '32';
}

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module.js';
import { env, resolveCorsOrigin } from './config/env.js';
import { AppExceptionsFilter } from './core/errors.js';
import { authRateLimitMiddleware } from './core/http/rate-limit.middleware.js';
import { securityHeadersMiddleware } from './core/http/security-headers.middleware.js';
import { traceIdMiddleware } from './core/http/trace-id.middleware.js';
import { AppLogger } from './core/logger.js';
import { DatabaseService } from './database/database.service.js';

async function bootstrap() {
  if (!process.env.TZ) {
    process.env.TZ = 'Asia/Ho_Chi_Minh';
  }
  if (process.env.TZ !== 'Asia/Ho_Chi_Minh') {
    throw new Error(
      `Invalid TZ="${process.env.TZ}". SportHub requires TZ=Asia/Ho_Chi_Minh for Vietnam wall-clock alignment.`,
    );
  }

  const expressApp = express();
  expressApp.disable('x-powered-by');
  // M-5: Trust 1 reverse-proxy hop (Nginx) so req.ip uses the real client IP appended by Nginx.
  expressApp.set('trust proxy', 1);
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bodyParser: false,
  });
  const logger = app.get(AppLogger);

  if (new Date().getTimezoneOffset() !== -420) {
    logger.warn('Process timezone offset is not UTC+7; verify TZ=Asia/Ho_Chi_Minh', {
      context: 'Bootstrap',
      offsetMinutes: new Date().getTimezoneOffset(),
      tz: process.env.TZ,
    });
  }

  app.setGlobalPrefix('api/v1');
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(traceIdMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(['/api/v1/auth/login', '/api/v1/auth/register'], authRateLimitMiddleware);
  app.enableCors({ origin: resolveCorsOrigin(env.corsOrigin), credentials: true });
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
