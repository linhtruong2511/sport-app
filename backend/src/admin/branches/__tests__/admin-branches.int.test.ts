import { type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../../../auth/auth.module.js';
import { AuthService } from '../../../auth/auth.service.js';
import { CatalogModule } from '../../../catalog/catalog.module.js';
import { closePool, sql } from '../../../config/database.js';
import { CoreModule } from '../../../core/core.module.js';
import { DbTransactionService } from '../../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../../core/errors.js';
import { traceIdMiddleware } from '../../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../../core/logger.js';
import { DatabaseModule } from '../../../database/database.module.js';
import { AdminBranchesModule } from '../admin-branches.module.js';

@Module({
  imports: [CoreModule, DatabaseModule, AuthModule, CatalogModule, AdminBranchesModule],
})
class AdminBranchesTestAppModule {}

const TEST_CODES = ['ZT01', 'ZT02'];
const TEST_ACCOUNT = '9988776655443';

describe('admin/branches integration (R-17 · EXT-01..04)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let tokens: { owner: string; staff: string };
  let cs01: { branchId: number; bankAccountNo: string };

  const validBody = {
    code: 'zt01',
    name: 'Cơ sở Test - Long Biên',
    address: 'Số 1 Nguyễn Văn Cừ, Long Biên, Hà Nội',
    phone: '02437003003',
    description: 'Cơ sở dùng cho integration test',
    bankBin: '970418',
    bankName: 'BIDV',
    bankAccountNo: TEST_ACCOUNT,
    bankAccountName: 'cong ty test',
  };

  const owner = () => ({ Authorization: `Bearer ${tokens.owner}` });

  async function cleanup(): Promise<void> {
    const exec = await txService.executor();
    const codes = TEST_CODES.map((c) => `'${c}'`).join(',');
    await exec.request().query(`
      DECLARE @ids TABLE (BranchId INT);
      INSERT INTO @ids SELECT BranchId FROM dbo.Branches WHERE Code IN (${codes});
      DELETE FROM dbo.AuditLogs WHERE EntityType = 'Branches'
        AND EntityId IN (SELECT CAST(BranchId AS VARCHAR(50)) FROM @ids);
      DELETE FROM dbo.BranchOpeningHours WHERE BranchId IN (SELECT BranchId FROM @ids);
      DELETE FROM dbo.Branches WHERE BranchId IN (SELECT BranchId FROM @ids);
    `);
    // Khôi phục CS01 nếu test đổi trạng thái/STK.
    await exec
      .request()
      .input('id', sql.Int, cs01.branchId)
      .input('acc', sql.VarChar(30), cs01.bankAccountNo)
      .query(`UPDATE dbo.Branches SET Status = 'ACTIVE', BankAccountNo = @acc WHERE BranchId = @id`);
  }

  beforeAll(async () => {
    app = await NestFactory.create(AdminBranchesTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    const authService = app.get(AuthService);

    const exec = await txService.executor();
    const res = await exec.request().query<{ BranchId: number; BankAccountNo: string }>(`
      SELECT BranchId, BankAccountNo FROM dbo.Branches WHERE Code = 'CS01'
    `);
    cs01 = {
      branchId: Number(res.recordset[0].BranchId),
      bankAccountNo: res.recordset[0].BankAccountNo,
    };

    const meta = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
    const [ownerLogin, staffLogin] = await Promise.all([
      authService.login({ identity: '0900000001', password: 'Owner@123' }, meta),
      authService.login({ identity: '0933445577', password: 'Nv123456' }, meta),
    ]);
    tokens = { owner: ownerLogin.accessToken, staff: staffLogin.accessToken };
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (txService) await cleanup();
    if (app) await app.close();
    await closePool();
  });

  it('chỉ OWNER được gọi admin/branches (STAFF → 403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/branches')
      .set('Authorization', `Bearer ${tokens.staff}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('EXT-01: liệt kê cơ sở kèm thông tin ngân hàng và số liệu ràng buộc', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/admin/branches').set(owner());
    expect(res.status).toBe(200);
    const item = res.body.data.find((b: { branchId: number }) => b.branchId === cs01.branchId);
    expect(item).toMatchObject({
      code: 'CS01',
      bankBin: '970436',
      bankAccountNo: cs01.bankAccountNo,
      status: 'ACTIVE',
      courtCount: expect.any(Number),
      activeStaffCount: expect.any(Number),
      activeBookingCount: expect.any(Number),
      pendingPaymentRequestCount: expect.any(Number),
    });
    expect(item.updatedAt).toMatch(/\+07:00$/);
  });

  it('EXT-02: tạo cơ sở → mã in hoa, 7 ngày giờ mở cửa mặc định, ghi AuditLogs', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/branches')
      .set(owner())
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      code: 'ZT01',
      status: 'ACTIVE',
      bankAccountName: 'CONG TY TEST',
      courtCount: 0,
      activeBookingCount: 0,
    });

    const branchId = res.body.data.branchId as number;
    const exec = await txService.executor();
    const hours = await exec
      .request()
      .input('id', sql.Int, branchId)
      .query<{ Cnt: number }>(`
        SELECT COUNT(*) AS Cnt FROM dbo.BranchOpeningHours
        WHERE BranchId = @id AND IsClosed = 0 AND OpenTime = '06:00' AND CloseTime = '22:00'
      `);
    expect(Number(hours.recordset[0].Cnt)).toBe(7);

    const audit = await exec
      .request()
      .input('id', sql.VarChar(50), String(branchId))
      .query<{ Cnt: number }>(`
        SELECT COUNT(*) AS Cnt FROM dbo.AuditLogs
        WHERE EntityType = 'Branches' AND EntityId = @id AND Action = 'CREATE_BRANCH'
      `);
    expect(Number(audit.recordset[0].Cnt)).toBe(1);

    // Cơ sở mới xuất hiện trên danh mục công khai (API-03)
    const pub = await request(app.getHttpServer()).get('/api/v1/branches');
    expect(pub.body.data.some((b: { branchId: number }) => b.branchId === branchId)).toBe(true);
  });

  it('EXT-02: trùng mã cơ sở → 409 BRANCH_CODE_DUPLICATE; trùng STK → 409 BRANCH_BANK_ACCOUNT_DUPLICATE', async () => {
    const dupCode = await request(app.getHttpServer())
      .post('/api/v1/admin/branches')
      .set(owner())
      .send({ ...validBody, code: 'CS01', bankAccountNo: '1231231231' });
    expect(dupCode.status).toBe(409);
    expect(dupCode.body.error.code).toBe('BRANCH_CODE_DUPLICATE');

    const dupAcc = await request(app.getHttpServer())
      .post('/api/v1/admin/branches')
      .set(owner())
      .send({ ...validBody, bankAccountNo: cs01.bankAccountNo });
    expect(dupAcc.status).toBe(409);
    expect(dupAcc.body.error.code).toBe('BRANCH_BANK_ACCOUNT_DUPLICATE');
  });

  it('EXT-02: thiếu một phần thông tin ngân hàng → 400 kèm lỗi trường', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/branches')
      .set(owner())
      .send({ ...validBody, bankName: '', bankAccountName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['bankAccountName', 'bankName']);
  });

  it('EXT-03: cập nhật STK của cơ sở, không đổi được mã; cơ sở không tồn tại → 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/branches')
      .set(owner())
      .send(validBody);
    const branchId = created.body.data.branchId as number;

    const res = await request(app.getHttpServer())
      .put(`/api/v1/admin/branches/${branchId}`)
      .set(owner())
      .send({ ...validBody, code: 'HACK', bankAccountNo: '5556667778' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('ZT01');
    expect(res.body.data.bankAccountNo).toBe('5556667778');

    const missing = await request(app.getHttpServer())
      .put('/api/v1/admin/branches/999999')
      .set(owner())
      .send(validBody);
    expect(missing.status).toBe(404);
  });

  it('EXT-04: ngừng cơ sở còn đơn hiệu lực → 409 BRANCH_HAS_ACTIVE_BOOKINGS kèm số đơn', async () => {
    const exec = await txService.executor();
    const cnt = await exec
      .request()
      .input('id', sql.Int, cs01.branchId)
      .query<{ Cnt: number }>(`
        SELECT COUNT(*) AS Cnt FROM dbo.Bookings
        WHERE BranchId = @id AND Status IN ('PENDING_PAYMENT','CONFIRMED','IN_USE')
      `);
    const activeCount = Number(cnt.recordset[0].Cnt);
    expect(activeCount).toBeGreaterThan(0); // seed mẫu có đơn CONFIRMED ở CS01

    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/branches/${cs01.branchId}/deactivate`)
      .set(owner());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_HAS_ACTIVE_BOOKINGS');
    expect(res.body.error.details).toEqual({ activeBookingCount: activeCount });
    expect(res.body.error.message).toContain(String(activeCount));
  });

  it('EXT-04: ngừng cơ sở không còn đơn → INACTIVE, ẩn khỏi danh mục công khai; mở lại được', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/branches')
      .set(owner())
      .send(validBody);
    const branchId = created.body.data.branchId as number;

    const off = await request(app.getHttpServer())
      .post(`/api/v1/admin/branches/${branchId}/deactivate`)
      .set(owner());
    expect(off.status).toBe(200);
    expect(off.body.data.status).toBe('INACTIVE');

    const pub = await request(app.getHttpServer()).get('/api/v1/branches');
    expect(pub.body.data.some((b: { branchId: number }) => b.branchId === branchId)).toBe(false);

    const on = await request(app.getHttpServer())
      .post(`/api/v1/admin/branches/${branchId}/activate`)
      .set(owner());
    expect(on.status).toBe(200);
    expect(on.body.data.status).toBe('ACTIVE');
  });
});
