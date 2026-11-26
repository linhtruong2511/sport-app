import { type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { SYSTEM_SETTING_KEYS } from '@sporthub/shared/settings';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../../../auth/auth.module.js';
import { AuthService } from '../../../auth/auth.service.js';
import { closePool, sql } from '../../../config/database.js';
import { CoreModule } from '../../../core/core.module.js';
import { DbTransactionService } from '../../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../../core/errors.js';
import { traceIdMiddleware } from '../../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../../core/logger.js';
import { SettingsService } from '../../../core/settings.service.js';
import { DatabaseModule } from '../../../database/database.module.js';
import { AdminSettingsModule } from '../admin-settings.module.js';

@Module({
  imports: [CoreModule, DatabaseModule, AuthModule, AdminSettingsModule],
})
class AdminSettingsTestAppModule {}

describe('admin/settings integration (R-17 · EXT-05/06)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let settingsService: SettingsService;
  let tokens: { owner: string; staff: string };
  let original: Map<string, string>;

  const owner = () => ({ Authorization: `Bearer ${tokens.owner}` });

  async function restore(): Promise<void> {
    const exec = await txService.executor();
    for (const [key, value] of original) {
      await exec
        .request()
        .input('key', sql.VarChar(100), key)
        .input('value', sql.NVarChar(500), value)
        .query('UPDATE dbo.SystemSettings SET SettingValue = @value WHERE SettingKey = @key');
    }
    await exec.request().query(`
      DELETE FROM dbo.AuditLogs WHERE EntityType = 'SystemSettings' AND Action = 'UPDATE_SETTINGS'
    `);
    settingsService.invalidate();
  }

  beforeAll(async () => {
    app = await NestFactory.create(AdminSettingsTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    settingsService = app.get(SettingsService);
    const authService = app.get(AuthService);

    const exec = await txService.executor();
    const res = await exec.request().query<{ SettingKey: string; SettingValue: string }>(
      'SELECT SettingKey, SettingValue FROM dbo.SystemSettings',
    );
    original = new Map(res.recordset.map((r) => [r.SettingKey, r.SettingValue]));

    const meta = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
    const [ownerLogin, staffLogin] = await Promise.all([
      authService.login({ identity: '0900000001', password: 'Owner@123' }, meta),
      authService.login({ identity: '0933445577', password: 'Nv123456' }, meta),
    ]);
    tokens = { owner: ownerLogin.accessToken, staff: staffLogin.accessToken };
  });

  afterEach(async () => {
    await restore();
  });

  afterAll(async () => {
    if (txService) await restore();
    if (app) await app.close();
    await closePool();
  });

  it('chỉ OWNER được xem/sửa tham số (STAFF → 403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${tokens.staff}`);
    expect(res.status).toBe(403);
  });

  it('EXT-05: trả đủ 10 tham số dạng số nguyên theo thứ tự định nghĩa', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/admin/settings').set(owner());
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { key: string }) => s.key)).toEqual([...SYSTEM_SETTING_KEYS]);
    const hold = res.body.data.find((s: { key: string }) => s.key === 'BOOKING_HOLD_MINUTES');
    expect(hold.value).toBe(Number(original.get('BOOKING_HOLD_MINUTES')));
    expect(hold.updatedAt).toMatch(/\+07:00$/);
  });

  it('EXT-06: lưu tham số → SettingsService đọc giá trị mới ngay (bỏ cache), ghi AuditLogs', async () => {
    // Nạp cache trước để chứng minh cache bị bỏ sau khi lưu.
    expect(await settingsService.getInt('CHECKIN_EARLY_MINUTES')).toBe(
      Number(original.get('CHECKIN_EARLY_MINUTES')),
    );

    const res = await request(app.getHttpServer())
      .put('/api/v1/admin/settings')
      .set(owner())
      .send({ values: { CHECKIN_EARLY_MINUTES: 25, REFUND_HALF_RATE: 40 } });
    expect(res.status).toBe(200);
    const byKey = new Map(res.body.data.map((s: { key: string; value: number }) => [s.key, s.value]));
    expect(byKey.get('CHECKIN_EARLY_MINUTES')).toBe(25);
    expect(byKey.get('REFUND_HALF_RATE')).toBe(40);

    expect(await settingsService.getInt('CHECKIN_EARLY_MINUTES')).toBe(25);
    expect(await settingsService.getInt('REFUND_HALF_RATE')).toBe(40);

    const exec = await txService.executor();
    const audit = await exec.request().query<{ OldValue: string; NewValue: string }>(`
      SELECT TOP 1 OldValue, NewValue FROM dbo.AuditLogs
      WHERE EntityType = 'SystemSettings' AND Action = 'UPDATE_SETTINGS'
      ORDER BY AuditId DESC
    `);
    expect(JSON.parse(audit.recordset[0].NewValue)).toEqual({
      CHECKIN_EARLY_MINUTES: 25,
      REFUND_HALF_RATE: 40,
    });
  });

  it('EXT-06: giá trị ngoài phạm vi → 400 kèm lỗi trường values.KEY', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/admin/settings')
      .set(owner())
      .send({ values: { BOOKING_HOLD_MINUTES: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('values.BOOKING_HOLD_MINUTES');
  });

  it('EXT-06: ràng buộc chéo xét trên giá trị đã gộp (QR > giữ chỗ hiện tại → 400, không lưu gì)', async () => {
    const hold = Number(original.get('BOOKING_HOLD_MINUTES'));
    const res = await request(app.getHttpServer())
      .put('/api/v1/admin/settings')
      .set(owner())
      .send({ values: { QR_EXPIRE_MINUTES: hold + 1, CHECKIN_EARLY_MINUTES: 30 } });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'values.QR_EXPIRE_MINUTES' }),
    ]);
    settingsService.invalidate();
    expect(await settingsService.getInt('CHECKIN_EARLY_MINUTES')).toBe(
      Number(original.get('CHECKIN_EARLY_MINUTES')),
    );
  });

  it('EXT-06: mốc hoàn một phần phải nhỏ hơn mốc hoàn 100%', async () => {
    const full = Number(original.get('REFUND_FULL_DAYS'));
    const res = await request(app.getHttpServer())
      .put('/api/v1/admin/settings')
      .set(owner())
      .send({ values: { REFUND_HALF_DAYS: full } });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('values.REFUND_HALF_DAYS');
  });
});
