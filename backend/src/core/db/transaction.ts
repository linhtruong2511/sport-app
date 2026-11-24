import { Inject, Injectable, Optional } from '@nestjs/common';
import type sqlTypes from 'mssql';
import { getPool, sql } from '../../config/database.js';
import { type DomainEvent, RealtimeService } from '../realtime/realtime.service.js';
import { isSqlDeadlockError } from './sql-errors.js';

export const DB_POOL_PROVIDER = Symbol('DB_POOL_PROVIDER');

export type PoolProvider = () => Promise<sqlTypes.ConnectionPool>;

export interface DbExecutor {
  request(): sqlTypes.Request;
}

export interface TxContext {
  request(): sqlTypes.Request;
  events: DomainEvent[];
  isTransaction: true;
}

@Injectable()
export class DbTransactionService {
  constructor(
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(DB_POOL_PROVIDER) private readonly poolProvider: PoolProvider = getPool,
  ) {}

  async executor(): Promise<DbExecutor> {
    const pool = await this.poolProvider();
    return {
      request: () => pool.request(),
    };
  }

  async withTransaction<T>(
    fn: (tx: TxContext) => Promise<T>,
    opts?: { maxRetries?: number },
  ): Promise<T> {
    const maxRetries = opts?.maxRetries ?? 2;
    const pool = await this.poolProvider();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const transaction = pool.transaction();
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

      const events: DomainEvent[] = [];
      const tx: TxContext = {
        request: () => transaction.request(),
        events,
        isTransaction: true,
      };

      try {
        const result = await fn(tx);
        await transaction.commit();
        this.realtimeService.flush(tx.events);
        return result;
      } catch (err) {
        await transaction.rollback().catch(() => undefined);
        if (isSqlDeadlockError(err) && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Transaction retry loop exited unexpectedly');
  }
}
