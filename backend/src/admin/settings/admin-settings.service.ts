import { Inject, Injectable } from '@nestjs/common';
import {
  SYSTEM_SETTING_KEYS,
  type SystemSettingKey,
  type UpdateSettingsInput,
  validateSettingsCrossRules,
} from '@sporthub/shared/settings';
import type { SystemSettingDto } from '@sporthub/shared/types';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthenticatedUser } from '../../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import { SettingsService } from '../../core/settings.service.js';
import {
  AdminSettingsRepository,
  type RawSetting,
  toSettingDto,
} from './admin-settings.repository.js';

function parseIntStrict(raw: RawSetting): number {
  const trimmed = raw.rawValue.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`SystemSettings key "${raw.key}" is not a valid integer`);
  }
  return Number.parseInt(trimmed, 10);
}

/** R-17 — Chủ sân chỉnh tham số nghiệp vụ trong SystemSettings: EXT-05/06. */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly repo: AdminSettingsRepository,
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // EXT-05
  async listSettings(): Promise<SystemSettingDto[]> {
    const exec = await this.txService.executor();
    const rows = await this.repo.listSettings(exec, SYSTEM_SETTING_KEYS);
    return this.ordered(rows).map((r) => toSettingDto(r, parseIntStrict(r)));
  }

  // EXT-06 — gộp giá trị mới với giá trị hiện tại rồi mới kiểm tra ràng buộc chéo.
  async updateSettings(
    input: UpdateSettingsInput,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<SystemSettingDto[]> {
    const now = this.clock.now();
    const changes = Object.entries(input.values).filter(
      (e): e is [SystemSettingKey, number] => e[1] !== undefined,
    );

    const result = await this.txService.withTransaction(async (tx) => {
      const rows = await this.repo.listSettings(tx, SYSTEM_SETTING_KEYS, true);
      const current = new Map(rows.map((r) => [r.key as SystemSettingKey, parseIntStrict(r)]));

      const missing = changes.filter(([key]) => !current.has(key));
      if (missing.length > 0) {
        throw new AppError('NOT_FOUND', {
          message: 'Không tìm thấy tham số cấu hình.',
          details: missing.map(([key]) => ({ field: `values.${key}`, message: 'Tham số chưa có trong hệ thống.' })),
        });
      }

      const merged: Partial<Record<SystemSettingKey, number>> = Object.fromEntries(current);
      for (const [key, value] of changes) merged[key] = value;

      const violations = validateSettingsCrossRules(merged);
      if (violations.length > 0) {
        throw new AppError('VALIDATION_ERROR', {
          details: violations.map((v) => ({ field: `values.${v.field}`, message: v.message })),
        });
      }

      const oldValue: Record<string, number> = {};
      const newValue: Record<string, number> = {};
      for (const [key, value] of changes) {
        if (current.get(key) === value) continue;
        await this.repo.updateSetting(tx, key, value, now);
        oldValue[key] = current.get(key)!;
        newValue[key] = value;
      }

      if (Object.keys(newValue).length > 0) {
        await this.auditService.writeInTx(tx, {
          userId: caller.userId,
          action: 'UPDATE_SETTINGS',
          entityType: 'SystemSettings',
          entityId: Object.keys(newValue).join(',').slice(0, 50),
          oldValue,
          newValue,
          ipAddress,
        });
        // Bỏ cache 60 s của SettingsService sau commit để tham số mới có hiệu lực ngay (PM2 1 instance — R-13).
        tx.afterCommit?.push(() => this.settingsService.invalidate());
      }

      const after = await this.repo.listSettings(tx, SYSTEM_SETTING_KEYS);
      return this.ordered(after).map((r) => toSettingDto(r, parseIntStrict(r)));
    });

    return result;
  }

  private ordered(rows: RawSetting[]): RawSetting[] {
    const order = new Map<string, number>(SYSTEM_SETTING_KEYS.map((k, i) => [k, i]));
    return [...rows].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  }
}
