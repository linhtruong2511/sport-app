import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { checkDatabaseConnection, closePool, type DbConnectionInfo } from '../config/database.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);

  checkConnection(): Promise<DbConnectionInfo> {
    return checkDatabaseConnection();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    await closePool();
    this.logger.log(`Connection pool closed${signal ? ` (${signal})` : ''}.`);
  }
}
