import { Injectable } from '@nestjs/common';
import type { SystemSettingDto } from '@sporthub/shared/types';
import { sql } from '../../config/database.js';
import type { DbExecutor, TxContext } from '../../core/db/transaction.js';
import { fromSqlDateTime, toIsoVn, toSqlDateTime } from '../../core/time.js';

interface SettingRow {
  SettingKey: string;
  SettingValue: string;
  Description: string | null;
  UpdatedAt: Date | string;
}

export interface RawSetting {
  key: string;
  rawValue: string;
  description: string | null;
  updatedAt: string;
}

@Injectable()
export class AdminSettingsRepository {
  async listSettings(exec: DbExecutor | TxContext, keys: readonly string[], lock = false): Promise<RawSetting[]> {
    const req = exec.request();
    const params = keys.map((key, i) => {
      req.input(`k${i}`, sql.VarChar(100), key);
      return `@k${i}`;
    });
    const res = await req.query<SettingRow>(`
      SELECT SettingKey, SettingValue, Description, UpdatedAt
      FROM dbo.SystemSettings ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
      WHERE SettingKey IN (${params.join(', ')})
    `);
    return res.recordset.map((r) => ({
      key: r.SettingKey,
      rawValue: r.SettingValue,
      description: r.Description,
      updatedAt: toIsoVn(fromSqlDateTime(r.UpdatedAt)),
    }));
  }

  async updateSetting(tx: TxContext, key: string, value: number, now: Date): Promise<number> {
    const res = await tx
      .request()
      .input('key', sql.VarChar(100), key)
      .input('value', sql.NVarChar(500), String(value))
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.SystemSettings
        SET SettingValue = @value, UpdatedAt = @now
        WHERE SettingKey = @key
      `);
    return res.rowsAffected[0] ?? 0;
  }
}

export function toSettingDto(raw: RawSetting, value: number): SystemSettingDto {
  return { key: raw.key, value, description: raw.description, updatedAt: raw.updatedAt };
}
