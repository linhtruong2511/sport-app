import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../config/env.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { fromSqlDateTime, toIsoVn } from '../core/time.js';
import { DatabaseService } from '../database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  check() {
    return ok(
      {
        status: 'ok',
        service: 'sportapp-backend',
        environment: env.nodeEnv,
      },
      this.clock,
    );
  }

  @Get('db')
  async checkDb() {
    try {
      const info = await this.db.checkConnection();
      return ok(
        {
          status: 'connected',
          targetServer: env.db.server,
          authType: env.db.authType,
          database: info.databaseName,
          serverName: info.serverName,
          currentUser: info.currentUser,
          serverTime: toIsoVn(fromSqlDateTime(info.serverTime)),
        },
        this.clock,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      throw new ServiceUnavailableException({
        status: 'disconnected',
        targetServer: env.db.server,
        database: env.db.database,
        message: 'Không thể kết nối cơ sở dữ liệu.',
        details: { error: message },
      });
    }
  }
}
