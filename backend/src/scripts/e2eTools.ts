/**
 * Công cụ hỗ trợ E2E (R-15) — chạy một lần, tiến trình riêng, chỉ trên DB `*_Test` với NODE_ENV=test.
 *
 *   node dist/scripts/e2eTools.js run-job <jobName>
 *   node dist/scripts/e2eTools.js expire-hold <bookingCode>
 *   node dist/scripts/e2eTools.js shift-booking <bookingCode> --minutes=<n>
 *
 * Phải chạy bản build (`npm run build`): tsx/esbuild không sinh decorator metadata nên Nest DI không hoạt động.
 *
 * In kết quả là một dòng JSON cuối cùng trên stdout để helper Playwright đọc.
 * Job chạy ngoài tiến trình server nên không phát socket (RealtimeService bỏ qua khi không có server).
 */
import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { closePool, getPool, sql } from '../config/database.js';
import { env } from '../config/env.js';
import { CoreModule } from '../core/core.module.js';
import { addMinutes, fromSqlDateTime, toIsoVn, toSqlDateTime } from '../core/time.js';
import { DatabaseModule } from '../database/database.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { JobsService } from '../jobs/jobs.service.js';

export const E2E_JOBS = {
  expireHolds: (s: JobsService) => s.runExpireHolds(),
  expireQr: (s: JobsService) => s.runExpireQr(),
  cancelNoShows: (s: JobsService) => s.runCancelNoShows(),
  closePaidNoShows: (s: JobsService) => s.runClosePaidNoShows(),
  autoComplete: (s: JobsService) => s.runAutoComplete(),
  sendReminders: (s: JobsService) => s.runSendReminders(),
  retryPromoNotify: (s: JobsService) => s.runRetryPromoNotify(),
} as const;

export type E2eJobName = keyof typeof E2E_JOBS;

@Module({
  imports: [CoreModule, DatabaseModule, IntegrationsModule, AuthModule, JobsModule],
})
class E2eJobsModule {}

// R-15: chỉ chạy trên DB kiểm thử
function assertTestEnvironment(): void {
  if (env.nodeEnv !== 'test') {
    throw new Error(`e2eTools chỉ chạy khi NODE_ENV=test (hiện tại: ${env.nodeEnv}).`);
  }
  if (!/^[A-Za-z0-9]+_Test$/i.test(env.db.database)) {
    throw new Error(`e2eTools chỉ chạy trên DB có hậu tố _Test (hiện tại: ${env.db.database}).`);
  }
}

async function runJob(name: string): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(E2E_JOBS, name)) {
    throw new Error(`Job không hợp lệ: ${name}. Hợp lệ: ${Object.keys(E2E_JOBS).join(', ')}`);
  }
  const app = await NestFactory.createApplicationContext(E2eJobsModule, {
    logger: ['error'],
    abortOnError: false,
  });
  try {
    const affected = await E2E_JOBS[name as E2eJobName](app.get(JobsService));
    return { job: name, affected };
  } finally {
    await app.close();
  }
}

// R-15: đưa hạn giữ chỗ và QR đang chờ về quá khứ để job expireHolds / expireQr xử lý
async function expireHold(bookingCode: string): Promise<Record<string, unknown>> {
  const pool = await getPool();
  const past = toSqlDateTime(addMinutes(new Date(), -1));
  const result = await pool
    .request()
    .input('code', sql.VarChar(20), bookingCode)
    .input('past', sql.DateTime2(0), past).query<{ updated: number }>(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
        UPDATE dbo.Bookings SET HoldExpireAt = @past
        WHERE BookingCode = @code AND Status = 'PENDING_PAYMENT';
        DECLARE @updated INT = @@ROWCOUNT;
        UPDATE pr SET pr.ExpiresAt = @past
        FROM dbo.PaymentRequest pr
        JOIN dbo.Bookings b ON b.BookingId = pr.BookingId
        WHERE b.BookingCode = @code AND pr.Status = 'PENDING';
      COMMIT;
      SELECT @updated AS updated;
    `);
  const updated = result.recordset[0]?.updated ?? 0;
  if (updated !== 1) {
    throw new Error(`Không tìm thấy đơn PENDING_PAYMENT ${bookingCode}.`);
  }
  return { bookingCode, holdExpireAt: 'past' };
}

// R-15: dời toàn bộ khung giờ của một đơn (StartAt/EndAt, slots, price lines) cùng một khoảng.
// Có thể đổi sang ngày khác; CK_Bookings_Time chặn đơn vắt qua nửa đêm, UX_BookingSlots_Court_Slot chặn va chạm ô.
async function shiftBooking(bookingCode: string, minutes: number): Promise<Record<string, unknown>> {
  if (!Number.isInteger(minutes) || minutes === 0) {
    throw new Error('--minutes phải là số nguyên khác 0.');
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input('code', sql.VarChar(20), bookingCode)
    .input('m', sql.Int, minutes).query<{ startAt: Date; endAt: Date }>(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
        DECLARE @id BIGINT = (SELECT BookingId FROM dbo.Bookings WITH (UPDLOCK, ROWLOCK) WHERE BookingCode = @code);
        IF @id IS NULL THROW 50001, 'BOOKING_NOT_FOUND', 1;

        UPDATE dbo.Bookings
        SET StartAt = DATEADD(MINUTE, @m, StartAt),
            EndAt   = DATEADD(MINUTE, @m, EndAt),
            -- giữ bất biến HoldExpireAt <= StartAt (SDD 3.5a)
            HoldExpireAt = CASE
              WHEN HoldExpireAt IS NULL THEN NULL
              WHEN HoldExpireAt > DATEADD(MINUTE, @m, StartAt) THEN DATEADD(MINUTE, @m, StartAt)
              ELSE HoldExpireAt END
        WHERE BookingId = @id;

        UPDATE dbo.BookingSlots SET SlotStart = DATEADD(MINUTE, @m, SlotStart) WHERE BookingId = @id;
        UPDATE dbo.BookingPriceLines
        SET StartAt = DATEADD(MINUTE, @m, StartAt), EndAt = DATEADD(MINUTE, @m, EndAt)
        WHERE BookingId = @id;
      COMMIT;
      SELECT StartAt AS startAt, EndAt AS endAt FROM dbo.Bookings WHERE BookingId = @id;
    `);
  const row = result.recordset[0];
  if (!row) throw new Error(`Không đọc lại được đơn ${bookingCode}.`);
  return {
    bookingCode,
    startAt: toIsoVn(fromSqlDateTime(row.startAt)),
    endAt: toIsoVn(fromSqlDateTime(row.endAt)),
  };
}

async function main(argv: string[]): Promise<void> {
  const [command, target] = argv;
  assertTestEnvironment();
  let output: Record<string, unknown>;
  switch (command) {
    case 'run-job':
      output = await runJob(target ?? '');
      break;
    case 'expire-hold':
      output = await expireHold(target ?? '');
      break;
    case 'shift-booking': {
      const arg = argv.find((a) => a.startsWith('--minutes='));
      output = await shiftBooking(target ?? '', Number(arg?.slice('--minutes='.length)));
      break;
    }
    default:
      throw new Error('Lệnh hợp lệ: run-job <jobName> | expire-hold <code> | shift-booking <code> --minutes=<n>');
  }
  console.log(JSON.stringify({ ok: true, ...output }));
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMain) {
  main(process.argv.slice(2))
    .catch((err: unknown) => {
      console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
