import { Injectable } from '@nestjs/common';
import type { BranchStatus } from '@sporthub/shared/enums';
import type { AdminBranchDto } from '@sporthub/shared/types';
import { sql } from '../../config/database.js';
import { mapSqlError } from '../../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../../core/db/transaction.js';
import { fromSqlDateTime, toIsoVn, toSqlDateTime } from '../../core/time.js';

interface BranchRow {
  BranchId: number;
  Code: string;
  Name: string;
  Address: string;
  Phone: string | null;
  Description: string | null;
  BankBin: string | null;
  BankName: string | null;
  BankAccountNo: string | null;
  BankAccountName: string | null;
  Status: BranchStatus;
  CreatedAt: Date | string;
  UpdatedAt: Date | string;
  CourtCount: number;
  ActiveStaffCount: number;
  ActiveBookingCount: number;
  PendingPaymentRequestCount: number;
}

export interface BranchWriteInput {
  name: string;
  address: string;
  phone: string | null;
  description: string | null;
  bankBin: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
}

// Đơn còn hiệu lực chiếm sân — cùng tập trạng thái với lưới lịch (availability.repository).
const ACTIVE_BOOKING_STATUSES_SQL = `('PENDING_PAYMENT', 'CONFIRMED', 'IN_USE')`;

// Giờ mở cửa mặc định cho cơ sở mới (R-17); Chủ sân chỉnh lại ở MH.11.3 (API-55).
const DEFAULT_OPEN_TIME = '06:00:00';
const DEFAULT_CLOSE_TIME = '22:00:00';

function mapRow(row: BranchRow): AdminBranchDto {
  return {
    branchId: Number(row.BranchId),
    code: row.Code,
    name: row.Name,
    address: row.Address,
    phone: row.Phone,
    description: row.Description,
    bankBin: row.BankBin,
    bankName: row.BankName,
    bankAccountNo: row.BankAccountNo,
    bankAccountName: row.BankAccountName,
    status: row.Status,
    courtCount: Number(row.CourtCount),
    activeStaffCount: Number(row.ActiveStaffCount),
    activeBookingCount: Number(row.ActiveBookingCount),
    pendingPaymentRequestCount: Number(row.PendingPaymentRequestCount),
    createdAt: toIsoVn(fromSqlDateTime(row.CreatedAt)),
    updatedAt: toIsoVn(fromSqlDateTime(row.UpdatedAt)),
  };
}

function bindWriteInput(req: ReturnType<DbExecutor['request']>, input: BranchWriteInput) {
  return req
    .input('name', sql.NVarChar(150), input.name)
    .input('address', sql.NVarChar(255), input.address)
    .input('phone', sql.VarChar(15), input.phone)
    .input('description', sql.NVarChar(1000), input.description)
    .input('bankBin', sql.VarChar(8), input.bankBin)
    .input('bankName', sql.NVarChar(100), input.bankName)
    .input('bankAccountNo', sql.VarChar(30), input.bankAccountNo)
    .input('bankAccountName', sql.NVarChar(100), input.bankAccountName);
}

@Injectable()
export class AdminBranchesRepository {
  private selectSql(whereClause: string): string {
    return `
      SELECT
        b.BranchId, b.Code, b.Name, b.Address, b.Phone, b.Description,
        b.BankBin, b.BankName, b.BankAccountNo, b.BankAccountName,
        b.Status, b.CreatedAt, b.UpdatedAt,
        (SELECT COUNT(*) FROM dbo.Courts c
          WHERE c.BranchId = b.BranchId AND c.Status = 'ACTIVE') AS CourtCount,
        (SELECT COUNT(*) FROM dbo.Users u
          WHERE u.BranchId = b.BranchId AND u.Role = 'STAFF' AND u.Status = 'ACTIVE') AS ActiveStaffCount,
        (SELECT COUNT(*) FROM dbo.Bookings bk
          WHERE bk.BranchId = b.BranchId AND bk.Status IN ${ACTIVE_BOOKING_STATUSES_SQL}) AS ActiveBookingCount,
        (SELECT COUNT(*) FROM dbo.PaymentRequest pr
          JOIN dbo.Bookings bk ON bk.BookingId = pr.BookingId
          WHERE bk.BranchId = b.BranchId AND pr.Status = 'PENDING' AND pr.ExpiresAt > @now
        ) AS PendingPaymentRequestCount
      FROM dbo.Branches b
      ${whereClause}
    `;
  }

  // EXT-01
  async listBranches(exec: DbExecutor, now: Date): Promise<AdminBranchDto[]> {
    const res = await exec
      .request()
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<BranchRow>(`${this.selectSql('')} ORDER BY b.BranchId ASC`);
    return res.recordset.map(mapRow);
  }

  async findBranchById(
    exec: DbExecutor | TxContext,
    branchId: number,
    now: Date,
  ): Promise<AdminBranchDto | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<BranchRow>(this.selectSql('WHERE b.BranchId = @branchId'));
    const row = res.recordset[0];
    return row ? mapRow(row) : null;
  }

  /** Khóa dòng cơ sở trong transaction trước khi đổi trạng thái/thông tin. */
  async lockBranch(tx: TxContext, branchId: number): Promise<boolean> {
    const res = await tx
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{ BranchId: number }>(`
        SELECT BranchId FROM dbo.Branches WITH (UPDLOCK, ROWLOCK) WHERE BranchId = @branchId
      `);
    return res.recordset.length > 0;
  }

  // EXT-04: đếm đơn còn hiệu lực; HOLDLOCK giữ khóa phạm vi tới hết transaction để chặn đơn mới chen vào.
  async countActiveBookings(tx: TxContext, branchId: number): Promise<number> {
    const res = await tx
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{ Cnt: number }>(`
        SELECT COUNT(*) AS Cnt
        FROM dbo.Bookings WITH (HOLDLOCK)
        WHERE BranchId = @branchId
          AND Status IN ${ACTIVE_BOOKING_STATUSES_SQL}
      `);
    return Number(res.recordset[0]?.Cnt ?? 0);
  }

  // EXT-02
  async insertBranch(
    tx: TxContext,
    input: BranchWriteInput & { code: string },
    now: Date,
  ): Promise<number> {
    try {
      const res = await bindWriteInput(tx.request(), input)
        .input('code', sql.VarChar(20), input.code)
        .input('now', sql.DateTime2(0), toSqlDateTime(now))
        .query<{ BranchId: number }>(`
          INSERT INTO dbo.Branches (
            Code, Name, Address, Phone, Description,
            BankBin, BankName, BankAccountNo, BankAccountName,
            Status, CreatedAt, UpdatedAt
          )
          OUTPUT inserted.BranchId
          VALUES (
            @code, @name, @address, @phone, @description,
            @bankBin, @bankName, @bankAccountNo, @bankAccountName,
            'ACTIVE', @now, @now
          )
        `);
      return Number(res.recordset[0].BranchId);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async insertDefaultOpeningHours(tx: TxContext, branchId: number): Promise<void> {
    await tx
      .request()
      .input('branchId', sql.Int, branchId)
      .input('openTime', sql.VarChar(8), DEFAULT_OPEN_TIME)
      .input('closeTime', sql.VarChar(8), DEFAULT_CLOSE_TIME)
      .query(`
        INSERT INTO dbo.BranchOpeningHours (BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed)
        SELECT @branchId, d.DayOfWeek, CAST(@openTime AS TIME(0)), CAST(@closeTime AS TIME(0)), 0
        FROM (VALUES (1), (2), (3), (4), (5), (6), (7)) AS d(DayOfWeek)
      `);
  }

  // EXT-03
  async updateBranch(
    tx: TxContext,
    branchId: number,
    input: BranchWriteInput,
    now: Date,
  ): Promise<void> {
    try {
      await bindWriteInput(tx.request(), input)
        .input('branchId', sql.Int, branchId)
        .input('now', sql.DateTime2(0), toSqlDateTime(now))
        .query(`
          UPDATE dbo.Branches
          SET Name = @name,
              Address = @address,
              Phone = @phone,
              Description = @description,
              BankBin = @bankBin,
              BankName = @bankName,
              BankAccountNo = @bankAccountNo,
              BankAccountName = @bankAccountName,
              UpdatedAt = @now
          WHERE BranchId = @branchId
        `);
    } catch (err) {
      mapSqlError(err);
    }
  }

  // EXT-04
  async updateStatus(
    tx: TxContext,
    branchId: number,
    status: BranchStatus,
    now: Date,
  ): Promise<void> {
    await tx
      .request()
      .input('branchId', sql.Int, branchId)
      .input('status', sql.VarChar(20), status)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Branches SET Status = @status, UpdatedAt = @now WHERE BranchId = @branchId
      `);
  }
}
