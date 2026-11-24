import { Injectable } from '@nestjs/common';
import type {
  PaymentMethod,
  PaymentPurpose,
  UserRole,
  UserStatus,
} from '@sporthub/shared/enums';
import { sql } from '../../config/database.js';
import { mapSqlError } from '../../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../../core/db/transaction.js';
import { addDays, fromSqlDateTime, parseVnDateTime, toIsoVn, toSqlDateTime } from '../../core/time.js';

export interface AdminStaffDto {
  userId: number;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  branch: {
    branchId: number;
    name: string;
  };
  status: UserStatus;
  counterBookingCount: number;
  collectedAmount: number;
  lastLoginAt: string | null;
}

export interface AdminStaffPaymentDto {
  paymentCode: string;
  bookingCode: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: number;
  collectedByName: string;
  paidAt: string;
}

interface RawStaffRow {
  UserId: number | string;
  Code: string;
  FullName: string;
  Phone: string;
  Email: string | null;
  BranchId: number;
  BranchName: string;
  Status: UserStatus;
  CounterBookingCount: number;
  CollectedAmount: number | string;
  LastLoginAt: Date | string | null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_[\]]/g, '\\$&');
}

function mapStaffRow(row: RawStaffRow): AdminStaffDto {
  return {
    userId: Number(row.UserId),
    code: row.Code,
    fullName: row.FullName,
    phone: row.Phone,
    email: row.Email ?? null,
    branch: {
      branchId: Number(row.BranchId),
      name: row.BranchName,
    },
    status: row.Status,
    counterBookingCount: Number(row.CounterBookingCount ?? 0),
    collectedAmount: Number(row.CollectedAmount ?? 0),
    lastLoginAt: row.LastLoginAt !== null ? toIsoVn(fromSqlDateTime(row.LastLoginAt)) : null,
  };
}

const STAFF_SELECT_COLUMNS = `
  u.UserId,
  u.Code,
  u.FullName,
  u.Phone,
  u.Email,
  u.BranchId,
  b.Name AS BranchName,
  u.Status,
  (
    SELECT COUNT(*)
    FROM dbo.Bookings bk
    WHERE bk.CreatedBy = u.UserId
      AND bk.Channel = 'COUNTER'
  ) AS CounterBookingCount,
  (
    SELECT ISNULL(SUM(p.Amount), 0)
    FROM dbo.Payments p
    WHERE p.CollectedBy = u.UserId
  ) AS CollectedAmount,
  u.LastLoginAt
`;

@Injectable()
export class AdminStaffRepository {
  async listStaff(
    exec: DbExecutor,
    filters: {
      branchId?: number;
      status?: UserStatus;
      q?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    items: AdminStaffDto[];
    totalItems: number;
    activeCount: number;
    lockedCount: number;
    countByBranch: Record<string, number>;
  }> {
    const conditions: string[] = ["u.Role = 'STAFF'"];
    const bindFilters = (req: ReturnType<DbExecutor['request']>) => {
      if (filters.branchId !== undefined) {
        req.input('branchId', sql.Int, filters.branchId);
      }
      if (filters.status !== undefined) {
        req.input('status', sql.VarChar(20), filters.status);
      }
      if (filters.q !== undefined) {
        req.input('qPattern', sql.NVarChar(120), `%${escapeLike(filters.q)}%`);
      }
      return req;
    };

    if (filters.branchId !== undefined) {
      conditions.push('u.BranchId = @branchId');
    }
    if (filters.status !== undefined) {
      conditions.push('u.Status = @status');
    }
    if (filters.q !== undefined) {
      conditions.push(
        "(u.FullName LIKE @qPattern ESCAPE '\\' OR u.Phone LIKE @qPattern ESCAPE '\\' OR u.Email LIKE @qPattern ESCAPE '\\' OR u.Code LIKE @qPattern ESCAPE '\\')",
      );
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const offset = (filters.page - 1) * filters.pageSize;

    const countRes = await bindFilters(exec.request()).query<{ TotalItems: number }>(`
      SELECT COUNT(*) AS TotalItems
      FROM dbo.Users u
      ${whereSql}
    `);
    const totalItems = Number(countRes.recordset[0]?.TotalItems ?? 0);

    const statusRes = await exec.request().query<{
      ActiveCount: number;
      LockedCount: number;
    }>(`
      SELECT
        ISNULL(SUM(CASE WHEN Status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS ActiveCount,
        ISNULL(SUM(CASE WHEN Status = 'LOCKED' THEN 1 ELSE 0 END), 0) AS LockedCount
      FROM dbo.Users
      WHERE Role = 'STAFF'
    `);
    const activeCount = Number(statusRes.recordset[0]?.ActiveCount ?? 0);
    const lockedCount = Number(statusRes.recordset[0]?.LockedCount ?? 0);

    const branchCountRes = await exec.request().query<{ BranchId: number; Cnt: number }>(`
      SELECT BranchId, COUNT(*) AS Cnt
      FROM dbo.Users
      WHERE Role = 'STAFF'
        AND BranchId IS NOT NULL
      GROUP BY BranchId
    `);
    const countByBranch: Record<string, number> = {};
    for (const row of branchCountRes.recordset) {
      countByBranch[String(row.BranchId)] = Number(row.Cnt);
    }

    const rowsRes = await bindFilters(exec.request())
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, filters.pageSize)
      .query<RawStaffRow>(`
        SELECT ${STAFF_SELECT_COLUMNS}
        FROM dbo.Users u
        INNER JOIN dbo.Branches b ON b.BranchId = u.BranchId
        ${whereSql}
        ORDER BY CASE WHEN u.Status = 'ACTIVE' THEN 0 ELSE 1 END, u.UserId ASC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

    return {
      items: rowsRes.recordset.map(mapStaffRow),
      totalItems,
      activeCount,
      lockedCount,
      countByBranch,
    };
  }

  async findStaffById(
    exec: DbExecutor | TxContext,
    userId: number,
  ): Promise<AdminStaffDto | null> {
    const lockHint = 'isTransaction' in exec ? 'WITH (UPDLOCK, ROWLOCK)' : '';
    const res = await exec
      .request()
      .input('userId', sql.BigInt, userId)
      .query<RawStaffRow>(`
        SELECT ${STAFF_SELECT_COLUMNS}
        FROM dbo.Users u ${lockHint}
        INNER JOIN dbo.Branches b ON b.BranchId = u.BranchId
        WHERE u.UserId = @userId
          AND u.Role = 'STAFF'
      `);

    const row = res.recordset[0];
    return row ? mapStaffRow(row) : null;
  }

  async findBranchById(
    exec: DbExecutor | TxContext,
    branchId: number,
  ): Promise<{ branchId: number; name: string } | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{ BranchId: number; Name: string }>(`
        SELECT BranchId, Name
        FROM dbo.Branches
        WHERE BranchId = @branchId
      `);
    const row = res.recordset[0];
    if (!row) return null;
    return { branchId: Number(row.BranchId), name: row.Name };
  }

  async findPhoneConflict(
    tx: TxContext,
    phone: string,
    excludeUserId?: number,
  ): Promise<{ userId: number; role: UserRole } | null> {
    const req = tx.request().input('phone', sql.VarChar(10), phone);
    let excludeClause = '';
    if (excludeUserId !== undefined) {
      req.input('excludeUserId', sql.BigInt, excludeUserId);
      excludeClause = 'AND UserId <> @excludeUserId';
    }
    const res = await req.query<{ UserId: number | string; Role: UserRole }>(`
      SELECT TOP 1 UserId, Role
      FROM dbo.Users
      WHERE Phone = @phone
        ${excludeClause}
    `);
    const row = res.recordset[0];
    return row ? { userId: Number(row.UserId), role: row.Role } : null;
  }

  async findEmailConflict(
    tx: TxContext,
    email: string,
    excludeUserId?: number,
  ): Promise<{ userId: number; role: UserRole } | null> {
    const req = tx.request().input('email', sql.VarChar(255), email);
    let excludeClause = '';
    if (excludeUserId !== undefined) {
      req.input('excludeUserId', sql.BigInt, excludeUserId);
      excludeClause = 'AND UserId <> @excludeUserId';
    }
    const res = await req.query<{ UserId: number | string; Role: UserRole }>(`
      SELECT TOP 1 UserId, Role
      FROM dbo.Users
      WHERE LOWER(Email) = LOWER(@email)
        ${excludeClause}
    `);
    const row = res.recordset[0];
    return row ? { userId: Number(row.UserId), role: row.Role } : null;
  }

  async insertStaff(
    tx: TxContext,
    input: {
      code: string;
      fullName: string;
      phone: string;
      email: string | null;
      passwordHash: string;
      branchId: number;
      status: UserStatus;
      now: Date;
    },
  ): Promise<number> {
    try {
      const res = await tx
        .request()
        .input('code', sql.VarChar(20), input.code)
        .input('fullName', sql.NVarChar(100), input.fullName)
        .input('phone', sql.VarChar(10), input.phone)
        .input('email', sql.VarChar(255), input.email)
        .input('passwordHash', sql.VarChar(255), input.passwordHash)
        .input('branchId', sql.Int, input.branchId)
        .input('status', sql.VarChar(20), input.status)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
        .query<{ UserId: number | string }>(`
          INSERT INTO dbo.Users (
            Code, FullName, Phone, Email, PasswordHash,
            Role, BranchId, Status, CreatedAt, UpdatedAt
          )
          OUTPUT inserted.UserId
          VALUES (
            @code, @fullName, @phone, @email, @passwordHash,
            'STAFF', @branchId, @status, @now, @now
          )
        `);
      return Number(res.recordset[0].UserId);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async updateStaff(
    tx: TxContext,
    input: {
      userId: number;
      fullName: string;
      phone: string;
      email: string | null;
      branchId: number;
      status: UserStatus;
      passwordHash?: string;
      now: Date;
    },
  ): Promise<void> {
    try {
      const req = tx
        .request()
        .input('userId', sql.BigInt, input.userId)
        .input('fullName', sql.NVarChar(100), input.fullName)
        .input('phone', sql.VarChar(10), input.phone)
        .input('email', sql.VarChar(255), input.email)
        .input('branchId', sql.Int, input.branchId)
        .input('status', sql.VarChar(20), input.status)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now));

      let passwordSetClause = '';
      if (input.passwordHash !== undefined) {
        req.input('passwordHash', sql.VarChar(255), input.passwordHash);
        passwordSetClause = ', PasswordHash = @passwordHash';
      }

      await req.query(`
        UPDATE dbo.Users
        SET FullName = @fullName,
            Phone = @phone,
            Email = @email,
            BranchId = @branchId,
            Status = @status,
            UpdatedAt = @now
            ${passwordSetClause}
        WHERE UserId = @userId
          AND Role = 'STAFF'
      `);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async lockStaff(tx: TxContext, userId: number, now: Date): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Users
        SET Status = 'LOCKED',
            UpdatedAt = @now
        WHERE UserId = @userId
          AND Role = 'STAFF'
      `);
  }

  async unlockStaff(tx: TxContext, userId: number, now: Date): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Users
        SET Status = 'ACTIVE',
            FailedLoginCount = 0,
            LockedUntil = NULL,
            UpdatedAt = @now
        WHERE UserId = @userId
          AND Role = 'STAFF'
      `);
  }

  async listStaffPayments(
    exec: DbExecutor,
    params: {
      userId: number;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    items: AdminStaffPaymentDto[];
    totalItems: number;
    totalAmount: number;
  }> {
    const conditions = ['p.CollectedBy = @userId'];
    const fromAt = params.from ? parseVnDateTime(params.from, '00:00:00') : null;
    const toExclusiveAt = params.to
      ? addDays(parseVnDateTime(params.to, '00:00:00'), 1)
      : null;

    const bindFilters = (req: ReturnType<DbExecutor['request']>) => {
      req.input('userId', sql.BigInt, params.userId);
      if (fromAt !== null) {
        req.input('fromAt', sql.DateTime2(0), toSqlDateTime(fromAt));
      }
      if (toExclusiveAt !== null) {
        req.input('toExclusiveAt', sql.DateTime2(0), toSqlDateTime(toExclusiveAt));
      }
      return req;
    };

    if (fromAt !== null) {
      conditions.push('p.PaidAt >= @fromAt');
    }
    if (toExclusiveAt !== null) {
      conditions.push('p.PaidAt < @toExclusiveAt');
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const offset = (params.page - 1) * params.pageSize;

    const summaryRes = await bindFilters(exec.request()).query<{
      TotalItems: number;
      TotalAmount: number | string;
    }>(`
      SELECT
        COUNT(*) AS TotalItems,
        ISNULL(SUM(p.Amount), 0) AS TotalAmount
      FROM dbo.Payments p
      ${whereSql}
    `);

    const totalItems = Number(summaryRes.recordset[0]?.TotalItems ?? 0);
    const totalAmount = Number(summaryRes.recordset[0]?.TotalAmount ?? 0);

    const rowsRes = await bindFilters(exec.request())
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, params.pageSize)
      .query<{
        PaymentCode: string;
        BookingCode: string;
        Purpose: PaymentPurpose;
        Method: PaymentMethod;
        Amount: number | string;
        CollectedByName: string;
        PaidAt: Date | string;
      }>(`
        SELECT
          p.PaymentCode,
          b.BookingCode,
          p.Purpose,
          p.Method,
          p.Amount,
          u.FullName AS CollectedByName,
          p.PaidAt
        FROM dbo.Payments p
        INNER JOIN dbo.Bookings b ON b.BookingId = p.BookingId
        INNER JOIN dbo.Users u ON u.UserId = p.CollectedBy
        ${whereSql}
        ORDER BY p.PaidAt DESC, p.PaymentId DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

    const items: AdminStaffPaymentDto[] = rowsRes.recordset.map((r) => ({
      paymentCode: r.PaymentCode,
      bookingCode: r.BookingCode,
      purpose: r.Purpose,
      method: r.Method,
      amount: Number(r.Amount),
      collectedByName: r.CollectedByName,
      paidAt: toIsoVn(fromSqlDateTime(r.PaidAt)),
    }));

    return {
      items,
      totalItems,
      totalAmount,
    };
  }
}
