import { Inject, Injectable, type OnModuleDestroy, Optional } from '@nestjs/common';
import type sqlTypes from 'mssql';
import { getPool, sql } from '../config/database.js';
import { DB_POOL_PROVIDER, type PoolProvider } from '../core/db/transaction.js';

@Injectable()
export class JobLockService implements OnModuleDestroy {
  private destroyed = false;
  private readonly activeTransactions = new Set<sqlTypes.Transaction>();

  constructor(
    @Optional() @Inject(DB_POOL_PROVIDER) private readonly poolProvider: PoolProvider = getPool,
  ) {}

  /**
   * Acquires a transaction-scoped SQL Server application lock on a dedicated transaction
   * so item-level transactions on the main pool never hold or reset the lock.
   */
  async withLock(resource: string, fn: () => Promise<void>): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }

    const pool = await this.poolProvider();
    const lockTx = pool.transaction();
    await lockTx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    this.activeTransactions.add(lockTx);

    let completed = false;
    try {
      const lockRes = await lockTx
        .request()
        .input('resource', sql.NVarChar(255), resource)
        .query<{ lockResult: number }>(`
          DECLARE @res INT;
          EXEC @res = sp_getapplock
            @Resource = @resource,
            @LockMode = 'Exclusive',
            @LockOwner = 'Transaction',
            @LockTimeout = 0;
          SELECT @res AS lockResult;
        `);

      const lockCode = lockRes.recordset[0]?.lockResult ?? -999;
      if (lockCode < 0) {
        return false;
      }

      await fn();
      await lockTx.commit();
      completed = true;
      return true;
    } finally {
      this.activeTransactions.delete(lockTx);
      if (!completed) {
        await lockTx.rollback().catch(() => undefined);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const pending = Array.from(this.activeTransactions);
    this.activeTransactions.clear();
    await Promise.all(pending.map((tx) => tx.rollback().catch(() => undefined)));
  }
}
