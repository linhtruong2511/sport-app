import { Router } from 'express';
import { checkDatabaseConnection } from '../config/database.js';
import { env } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sportapp-backend',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/db', async (_req, res) => {
  try {
    const info = await checkDatabaseConnection();
    res.json({
      status: 'connected',
      targetServer: env.db.server,
      authType: env.db.authType,
      database: info.databaseName,
      serverName: info.serverName,
      currentUser: info.currentUser,
      serverTime: info.serverTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    res.status(503).json({
      status: 'disconnected',
      targetServer: env.db.server,
      database: env.db.database,
      error: message,
    });
  }
});
