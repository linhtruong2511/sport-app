import { Injectable } from '@nestjs/common';
import type {
  BankMatchStatus,
  BookingStatus,
  CancelType,
  PaymentStatus,
  RefundStatus,
} from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import type { DbExecutor, TxContext } from '../core/db/transaction.js';
import { addDays, parseVnDateTime, toSqlDateTime } from '../core/time.js';
import type {
  ReconciliationStatusFilter,
  RefundStatusFilter,
} from './reconciliation.schemas.js';

export interface BankTransactionRow {
  BankTxnId: number | string;
  Provider: string;
  ProviderTxnId: string;
  AccountNo: string;
  Amount: number | string;
  Content: string | null;
  TransactionAt: Date | string;
  MatchStatus: BankMatchStatus;
  MatchedBookingId: number | string | null;
  ReceivedAt: Date | string;
  ResolvedBy: number | string | null;
  ResolvedByName: string | null;
  ResolvedAt: Date | string | null;
  ResolveNote: string | null;
  BranchId: number | null;
  BranchName: string | null;
  BankName: string | null;
  MatchedBookingCode: string | null;
  MatchedBookingBranchId: number | null;
  MatchedBookingStatus: BookingStatus | null;
  MatchedBookingPaymentStatus: PaymentStatus | null;
  MatchedBookingAmountDueNow: number | string | null;
  MatchedBookingPaidAmount: number | string | null;
  MatchedBookingRemainingAmount: number | string | null;
  MatchedBookingHoldExpireAt: Date | string | null;
  MatchedBookingCustomerName: string | null;
  PaymentId: number | string | null;
}

export interface BankTransactionLockRow {
  BankTxnId: number | string;
  Provider: string;
  ProviderTxnId: string;
  AccountNo: string;
  Amount: number | string;
  Content: string | null;
  TransactionAt: Date | string;
  MatchStatus: BankMatchStatus;
  MatchedBookingId: number | string | null;
  ReceivedAt: Date | string;
  ResolvedBy: number | string | null;
  ResolvedAt: Date | string | null;
  ResolveNote: string | null;
  BranchId: number | null;
  BranchName: string | null;
}

export interface ParsedBookingLookupRow {
  BookingId: number | string;
  BookingCode: string;
  BranchId: number;
  Status: BookingStatus;
  PaymentStatus: PaymentStatus;
  AmountDueNow: number | string;
  PaidAmount: number | string;
  RemainingAmount: number | string;
  HoldExpireAt: Date | string | null;
  CustomerName: string;
}

export interface CandidateBookingRow {
  BookingId: number | string;
  BookingCode: string;
  CustomerName: string;
  CustomerPhone: string;
  Status: BookingStatus;
  PaymentStatus: PaymentStatus;
  AmountDueNow: number | string;
  RemainingAmount: number | string;
  StartAt: Date | string;
  CourtName: string;
}

export interface RefundListRow {
  RefundId: number | string;
  BookingId: number | string;
  BookingCode: string;
  BranchId: number;
  BranchName: string;
  CourtId: number;
  CourtName: string;
  CustomerName: string;
  CustomerPhone: string;
  Amount: number | string;
  Rate: number | string;
  CancelType: CancelType | null;
  Reason: string | null;
  Status: RefundStatus;
  CreatedAt: Date | string;
  ProcessedAt: Date | string | null;
  ProcessedBy: number | string | null;
  ProcessedByName: string | null;
  Note: string | null;
}

export interface RefundLockRow {
  RefundId: number | string;
  BookingId: number | string;
  BookingCode: string;
  BranchId: number;
  CustomerUserId: number | string | null;
  Amount: number | string;
  Rate: number | string;
  Reason: string | null;
  Status: RefundStatus;
  Note: string | null;
}

function bindBankTxnFilters(
  req: ReturnType<DbExecutor['request']>,
  params: { branchId: number | null; from?: string; to?: string },
): string[] {
  const clauses: string[] = [];

  if (params.branchId !== null) {
    req.input('branchId', sql.Int, params.branchId);
    clauses.push('br.BranchId = @branchId');
  }
  if (params.from) {
    const fromStart = parseVnDateTime(params.from, '00:00:00');
    req.input('fromStart', sql.DateTime2(0), toSqlDateTime(fromStart));
    clauses.push('bt.TransactionAt >= @fromStart');
  }
  if (params.to) {
    const toExclusive = addDays(parseVnDateTime(params.to, '00:00:00'), 1);
    req.input('toExclusive', sql.DateTime2(0), toSqlDateTime(toExclusive));
    clauses.push('bt.TransactionAt < @toExclusive');
  }

  return clauses;
}

function bindRefundFilters(
  req: ReturnType<DbExecutor['request']>,
  params: { branchId?: number; from?: string; to?: string },
): string[] {
  const clauses: string[] = [];

  if (params.branchId !== undefined) {
    req.input('branchId', sql.Int, params.branchId);
    clauses.push('b.BranchId = @branchId');
  }
  if (params.from) {
    const fromStart = parseVnDateTime(params.from, '00:00:00');
    req.input('fromStart', sql.DateTime2(0), toSqlDateTime(fromStart));
    clauses.push('r.CreatedAt >= @fromStart');
  }
  if (params.to) {
    const toExclusive = addDays(parseVnDateTime(params.to, '00:00:00'), 1);
    req.input('toExclusive', sql.DateTime2(0), toSqlDateTime(toExclusive));
    clauses.push('r.CreatedAt < @toExclusive');
  }

  return clauses;
}

@Injectable()
export class ReconciliationRepository {
  async listBankTransactions(
    exec: DbExecutor,
    params: {
      branchId: number | null;
      status: ReconciliationStatusFilter;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    rows: BankTransactionRow[];
    totalItems: number;
    countByStatus: Record<BankMatchStatus, number>;
  }> {
    const countReq = exec.request();
    const baseClauses = bindBankTxnFilters(countReq, params);
    const baseWhere = baseClauses.length > 0 ? `WHERE ${baseClauses.join(' AND ')}` : '';

    const countsRes = await countReq.query<{ MatchStatus: BankMatchStatus; Cnt: number }>(`
      SELECT bt.MatchStatus, COUNT(*) AS Cnt
      FROM dbo.BankTransactions bt
      LEFT JOIN dbo.Branches br ON br.BankAccountNo = bt.AccountNo
      ${baseWhere}
      GROUP BY bt.MatchStatus
    `);

    const countByStatus: Record<BankMatchStatus, number> = {
      PENDING: 0,
      MATCHED: 0,
      NEEDS_REVIEW: 0,
      RESOLVED: 0,
      IGNORED: 0,
    };

    let totalAll = 0;
    for (const r of countsRes.recordset) {
      const cnt = Number(r.Cnt);
      countByStatus[r.MatchStatus] = cnt;
      totalAll += cnt;
    }

    const totalItems = params.status === 'ALL' ? totalAll : countByStatus[params.status];
    const offset = (params.page - 1) * params.pageSize;

    const listReq = exec.request();
    const listClauses = bindBankTxnFilters(listReq, params);
    if (params.status !== 'ALL') {
      listReq.input('status', sql.VarChar(20), params.status);
      listClauses.push('bt.MatchStatus = @status');
    }
    const listWhere = listClauses.length > 0 ? `WHERE ${listClauses.join(' AND ')}` : '';

    listReq.input('offset', sql.Int, offset);
    listReq.input('pageSize', sql.Int, params.pageSize);

    const rowsRes = await listReq.query<BankTransactionRow>(`
      SELECT
        bt.BankTxnId,
        bt.Provider,
        bt.ProviderTxnId,
        bt.AccountNo,
        bt.Amount,
        bt.Content,
        bt.TransactionAt,
        bt.MatchStatus,
        bt.MatchedBookingId,
        bt.ReceivedAt,
        bt.ResolvedBy,
        ru.FullName AS ResolvedByName,
        bt.ResolvedAt,
        bt.ResolveNote,
        br.BranchId,
        br.Name AS BranchName,
        br.BankName,
        b.BookingCode AS MatchedBookingCode,
        b.BranchId AS MatchedBookingBranchId,
        b.Status AS MatchedBookingStatus,
        b.PaymentStatus AS MatchedBookingPaymentStatus,
        b.AmountDueNow AS MatchedBookingAmountDueNow,
        b.PaidAmount AS MatchedBookingPaidAmount,
        b.RemainingAmount AS MatchedBookingRemainingAmount,
        b.HoldExpireAt AS MatchedBookingHoldExpireAt,
        COALESCE(cu.FullName, b.GuestName) AS MatchedBookingCustomerName,
        p.PaymentId
      FROM dbo.BankTransactions bt
      LEFT JOIN dbo.Branches br ON br.BankAccountNo = bt.AccountNo
      LEFT JOIN dbo.Bookings b ON b.BookingId = bt.MatchedBookingId
      LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
      LEFT JOIN dbo.Users ru ON ru.UserId = bt.ResolvedBy
      LEFT JOIN dbo.Payments p ON p.BankTxnId = bt.BankTxnId
      ${listWhere}
      ORDER BY bt.TransactionAt DESC, bt.BankTxnId DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return {
      rows: rowsRes.recordset,
      totalItems,
      countByStatus,
    };
  }

  async findBookingsByCodes(
    exec: DbExecutor,
    codes: string[],
  ): Promise<Map<string, ParsedBookingLookupRow>> {
    const result = new Map<string, ParsedBookingLookupRow>();
    if (codes.length === 0) {
      return result;
    }

    const req = exec.request();
    const placeholders = codes.map((code, idx) => {
      const paramName = `code${idx}`;
      req.input(paramName, sql.VarChar(20), code);
      return `@${paramName}`;
    });

    const res = await req.query<ParsedBookingLookupRow>(`
      SELECT
        b.BookingId,
        b.BookingCode,
        b.BranchId,
        b.Status,
        b.PaymentStatus,
        b.AmountDueNow,
        b.PaidAmount,
        b.RemainingAmount,
        b.HoldExpireAt,
        COALESCE(cu.FullName, b.GuestName, N'') AS CustomerName
      FROM dbo.Bookings b
      LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
      WHERE b.BookingCode IN (${placeholders.join(', ')})
    `);

    for (const row of res.recordset) {
      result.set(row.BookingCode, row);
    }
    return result;
  }

  async findBankTxnById(exec: DbExecutor, bankTxnId: number): Promise<BankTransactionLockRow | null> {
    const res = await exec
      .request()
      .input('bankTxnId', sql.BigInt, bankTxnId)
      .query<BankTransactionLockRow>(`
        SELECT
          bt.BankTxnId,
          bt.Provider,
          bt.ProviderTxnId,
          bt.AccountNo,
          bt.Amount,
          bt.Content,
          bt.TransactionAt,
          bt.MatchStatus,
          bt.MatchedBookingId,
          bt.ReceivedAt,
          bt.ResolvedBy,
          bt.ResolvedAt,
          bt.ResolveNote,
          br.BranchId,
          br.Name AS BranchName
        FROM dbo.BankTransactions bt
        LEFT JOIN dbo.Branches br ON br.BankAccountNo = bt.AccountNo
        WHERE bt.BankTxnId = @bankTxnId
      `);

    return res.recordset[0] ?? null;
  }

  async lockBankTxnById(
    tx: TxContext,
    bankTxnId: number,
  ): Promise<BankTransactionLockRow | null> {
    const res = await tx
      .request()
      .input('bankTxnId', sql.BigInt, bankTxnId)
      .query<BankTransactionLockRow>(`
        SELECT
          bt.BankTxnId,
          bt.Provider,
          bt.ProviderTxnId,
          bt.AccountNo,
          bt.Amount,
          bt.Content,
          bt.TransactionAt,
          bt.MatchStatus,
          bt.MatchedBookingId,
          bt.ReceivedAt,
          bt.ResolvedBy,
          bt.ResolvedAt,
          bt.ResolveNote,
          br.BranchId,
          br.Name AS BranchName
        FROM dbo.BankTransactions bt WITH (UPDLOCK, ROWLOCK)
        LEFT JOIN dbo.Branches br ON br.BankAccountNo = bt.AccountNo
        WHERE bt.BankTxnId = @bankTxnId
      `);

    return res.recordset[0] ?? null;
  }

  async findCandidateBookings(
    exec: DbExecutor,
    branchId: number,
    txnAmount: number,
    q?: string,
  ): Promise<CandidateBookingRow[]> {
    const req = exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('txnAmount', sql.Decimal(18, 0), txnAmount);

    let searchSql = '';
    if (q && q.length > 0) {
      req.input('q', sql.NVarChar(120), `%${q}%`);
      searchSql = `
        AND (
          b.BookingCode LIKE @q
          OR cu.FullName LIKE @q
          OR cu.Phone LIKE @q
          OR b.GuestName LIKE @q
          OR b.GuestPhone LIKE @q
        )
      `;
    }

    const res = await req.query<CandidateBookingRow>(`
      SELECT
        b.BookingId,
        b.BookingCode,
        COALESCE(cu.FullName, b.GuestName, N'') AS CustomerName,
        COALESCE(cu.Phone, b.GuestPhone, '') AS CustomerPhone,
        b.Status,
        b.PaymentStatus,
        b.AmountDueNow,
        b.RemainingAmount,
        b.StartAt,
        c.Name AS CourtName
      FROM dbo.Bookings b
      INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
      LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
      WHERE b.BranchId = @branchId
        AND (
          b.Status = 'PENDING_PAYMENT'
          OR (b.Status = 'CONFIRMED' AND b.PaymentStatus = 'DEPOSITED')
        )
        ${searchSql}
      ORDER BY
        CASE
          WHEN (
            CASE WHEN b.Status = 'PENDING_PAYMENT' THEN b.AmountDueNow ELSE b.RemainingAmount END
          ) = @txnAmount THEN 0
          ELSE 1
        END ASC,
        b.CreatedAt DESC,
        b.BookingId DESC
    `);

    return res.recordset;
  }

  async findPendingPaymentRequestId(
    tx: TxContext,
    bookingId: number,
  ): Promise<number | null> {
    const res = await tx
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query<{ RequestId: number | string }>(`
        SELECT TOP 1 RequestId
        FROM dbo.PaymentRequest WITH (UPDLOCK, ROWLOCK)
        WHERE BookingId = @bookingId
          AND Status = 'PENDING'
        ORDER BY RequestId DESC
      `);

    return res.recordset[0] ? Number(res.recordset[0].RequestId) : null;
  }

  async markPaymentRequestPaid(tx: TxContext, requestId: number): Promise<void> {
    await tx
      .request()
      .input('requestId', sql.BigInt, requestId)
      .query(`
        UPDATE dbo.PaymentRequest
        SET Status = 'PAID'
        WHERE RequestId = @requestId
          AND Status = 'PENDING'
      `);
  }

  async updateBankTransactionResolution(
    tx: TxContext,
    bankTxnId: number,
    input: {
      matchStatus: 'RESOLVED' | 'IGNORED';
      matchedBookingId?: number | null;
      resolvedBy: number;
      resolvedAt: Date;
      resolveNote: string | null;
    },
  ): Promise<void> {
    const req = tx
      .request()
      .input('bankTxnId', sql.BigInt, bankTxnId)
      .input('matchStatus', sql.VarChar(20), input.matchStatus)
      .input('resolvedBy', sql.BigInt, input.resolvedBy)
      .input('resolvedAt', sql.DateTime2(0), toSqlDateTime(input.resolvedAt))
      .input(
        'resolveNote',
        sql.NVarChar(500),
        input.resolveNote !== null ? input.resolveNote.slice(0, 500) : null,
      );

    let setMatchedBookingSql = '';
    if (input.matchedBookingId !== undefined) {
      req.input('matchedBookingId', sql.BigInt, input.matchedBookingId);
      setMatchedBookingSql = ', MatchedBookingId = @matchedBookingId';
    }

    await req.query(`
      UPDATE dbo.BankTransactions
      SET MatchStatus = @matchStatus
          ${setMatchedBookingSql},
          ResolvedBy = @resolvedBy,
          ResolvedAt = @resolvedAt,
          ResolveNote = @resolveNote
      WHERE BankTxnId = @bankTxnId
    `);
  }

  async findUserFullNameById(exec: DbExecutor, userId: number): Promise<string | null> {
    const res = await exec
      .request()
      .input('userId', sql.BigInt, userId)
      .query<{ FullName: string }>(`
        SELECT FullName
        FROM dbo.Users
        WHERE UserId = @userId
      `);

    return res.recordset[0]?.FullName ?? null;
  }

  async listRefunds(
    exec: DbExecutor,
    params: {
      branchId?: number;
      status: RefundStatusFilter;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    rows: RefundListRow[];
    totalItems: number;
    totalAmount: number;
    countByStatus: Record<RefundStatus, number>;
  }> {
    const aggReq = exec.request();
    const baseClauses = bindRefundFilters(aggReq, params);
    const baseWhere = baseClauses.length > 0 ? `WHERE ${baseClauses.join(' AND ')}` : '';

    const aggRes = await aggReq.query<{
      Status: RefundStatus;
      Cnt: number;
      SumAmount: number | string;
    }>(`
      SELECT r.Status, COUNT(*) AS Cnt, COALESCE(SUM(r.Amount), 0) AS SumAmount
      FROM dbo.Refunds r
      INNER JOIN dbo.Bookings b ON b.BookingId = r.BookingId
      ${baseWhere}
      GROUP BY r.Status
    `);

    const countByStatus: Record<RefundStatus, number> = {
      PENDING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    let totalAllCount = 0;
    let totalAllAmount = 0;
    const sumByStatus: Record<RefundStatus, number> = {
      PENDING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };

    for (const r of aggRes.recordset) {
      const cnt = Number(r.Cnt);
      const sum = Number(r.SumAmount);
      countByStatus[r.Status] = cnt;
      sumByStatus[r.Status] = sum;
      totalAllCount += cnt;
      totalAllAmount += sum;
    }

    const totalItems = params.status === 'ALL' ? totalAllCount : countByStatus[params.status];
    const totalAmount = params.status === 'ALL' ? totalAllAmount : sumByStatus[params.status];
    const offset = (params.page - 1) * params.pageSize;

    const listReq = exec.request();
    const listClauses = bindRefundFilters(listReq, params);
    if (params.status !== 'ALL') {
      listReq.input('status', sql.VarChar(20), params.status);
      listClauses.push('r.Status = @status');
    }
    const listWhere = listClauses.length > 0 ? `WHERE ${listClauses.join(' AND ')}` : '';

    listReq.input('offset', sql.Int, offset);
    listReq.input('pageSize', sql.Int, params.pageSize);

    const rowsRes = await listReq.query<RefundListRow>(`
      SELECT
        r.RefundId,
        r.BookingId,
        b.BookingCode,
        b.BranchId,
        br.Name AS BranchName,
        b.CourtId,
        c.Name AS CourtName,
        COALESCE(cu.FullName, b.GuestName, N'') AS CustomerName,
        COALESCE(cu.Phone, b.GuestPhone, '') AS CustomerPhone,
        r.Amount,
        r.Rate,
        b.CancelType,
        r.Reason,
        r.Status,
        r.CreatedAt,
        r.ProcessedAt,
        r.ProcessedBy,
        pu.FullName AS ProcessedByName,
        r.Note
      FROM dbo.Refunds r
      INNER JOIN dbo.Bookings b ON b.BookingId = r.BookingId
      INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
      INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
      LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
      LEFT JOIN dbo.Users pu ON pu.UserId = r.ProcessedBy
      ${listWhere}
      ORDER BY
        CASE WHEN r.Status = 'PENDING' THEN 0 ELSE 1 END ASC,
        r.CreatedAt DESC,
        r.RefundId DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return {
      rows: rowsRes.recordset,
      totalItems,
      totalAmount,
      countByStatus,
    };
  }

  async lockRefundById(tx: TxContext, refundId: number): Promise<RefundLockRow | null> {
    const res = await tx
      .request()
      .input('refundId', sql.BigInt, refundId)
      .query<RefundLockRow>(`
        SELECT
          r.RefundId,
          r.BookingId,
          b.BookingCode,
          b.BranchId,
          b.CustomerUserId,
          r.Amount,
          r.Rate,
          r.Reason,
          r.Status,
          r.Note
        FROM dbo.Refunds r WITH (UPDLOCK, ROWLOCK)
        INNER JOIN dbo.Bookings b ON b.BookingId = r.BookingId
        WHERE r.RefundId = @refundId
      `);

    return res.recordset[0] ?? null;
  }

  async updateRefundStatus(
    tx: TxContext,
    refundId: number,
    input: {
      status: 'COMPLETED' | 'FAILED';
      processedBy: number;
      processedAt: Date;
      note: string | null;
    },
  ): Promise<void> {
    await tx
      .request()
      .input('refundId', sql.BigInt, refundId)
      .input('status', sql.VarChar(20), input.status)
      .input('processedBy', sql.BigInt, input.processedBy)
      .input('processedAt', sql.DateTime2(0), toSqlDateTime(input.processedAt))
      .input('note', sql.NVarChar(500), input.note !== null ? input.note.slice(0, 500) : null)
      .query(`
        UPDATE dbo.Refunds
        SET Status = @status,
            ProcessedBy = @processedBy,
            ProcessedAt = @processedAt,
            Note = @note
        WHERE RefundId = @refundId
      `);
  }
}
