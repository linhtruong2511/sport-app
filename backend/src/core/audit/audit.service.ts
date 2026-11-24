import { Inject, Injectable } from '@nestjs/common';
import { sql } from '../../config/database.js';
import { CLOCK, type Clock } from '../clock.js';
import type { TxContext } from '../db/transaction.js';
import { toSqlDateTime } from '../time.js';

export interface WriteAuditInput {
  userId: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

function serializeAuditJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

@Injectable()
export class AuditService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  async writeInTx(tx: TxContext, input: WriteAuditInput): Promise<void> {
    const now = this.clock.now();
    await tx
      .request()
      .input('userId', sql.BigInt, input.userId)
      .input('action', sql.VarChar(50), input.action)
      .input('entityType', sql.VarChar(50), input.entityType)
      .input('entityId', sql.VarChar(50), String(input.entityId))
      .input('oldValue', sql.NVarChar(sql.MAX), serializeAuditJson(input.oldValue))
      .input('newValue', sql.NVarChar(sql.MAX), serializeAuditJson(input.newValue))
      .input('ipAddress', sql.VarChar(45), input.ipAddress ? input.ipAddress.slice(0, 45) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        INSERT INTO dbo.AuditLogs (
          UserId, Action, EntityType, EntityId, OldValue, NewValue, IpAddress, CreatedAt
        )
        VALUES (
          @userId, @action, @entityType, @entityId, @oldValue, @newValue, @ipAddress, @now
        )
      `);
  }
}
