import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'sportapp-backend',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('db')
  async checkDb() {
    try {
      const info = await this.db.checkConnection();
      return {
        status: 'connected',
        targetServer: env.db.server,
        authType: env.db.authType,
        database: info.databaseName,
        serverName: info.serverName,
        currentUser: info.currentUser,
        serverTime: info.serverTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      throw new ServiceUnavailableException({
        status: 'disconnected',
        targetServer: env.db.server,
        database: env.db.database,
        error: message,
      });
    }
  }
}
