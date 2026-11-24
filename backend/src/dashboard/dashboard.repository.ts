import { Injectable } from '@nestjs/common';
import type {
  BlockType,
  BookingStatus,
  CourtStatus,
  PaymentMethod,
  PaymentOption,
  PaymentPurpose,
  PaymentStatus,
} from '@sporthub/shared/enums';
import type { BookingRow } from '../bookings/bookings.mapper.js';
import { sql } from '../config/database.js';
import type { DbExecutor } from '../core/db/transaction.js';
import { fromSqlDateTime, toSqlDateTime } from '../core/time.js';

const BOOKING_SELECT = `
  b.BookingId,
  b.BookingCode,
  b.BranchId,
  br.Name AS BranchName,
  br.Address AS BranchAddress,
  b.CourtId,
  c.Code AS CourtCode,
  c.Name AS CourtName,
  sp.Code AS SportCode,
  sp.Name AS SportName,
  b.CustomerUserId,
  cu.FullName AS CustomerUserName,
  cu.Phone AS CustomerUserPhone,
  b.GuestName,
  b.GuestPhone,
  b.StartAt,
  b.EndAt,
  b.BaseAmount,
  b.DiscountAmount,
  b.TotalAmount,
  b.PaymentOption,
  b.DepositType,
  b.DepositValue,
  b.DepositAmount,
  b.AmountDueNow,
  b.PaidAmount,
  b.RemainingAmount,
  b.Status,
  b.PaymentStatus,
  b.HoldExpireAt,
  b.PromotionCode,
  b.CanceledBy,
  cb.FullName AS CanceledByName,
  b.CanceledAt,
  b.CancelReason,
  b.CancelType,
  b.RefundRate,
  b.RefundAmount,
  b.ReminderSentAt,
  b.Note,
  b.CreatedBy,
  b.CreatedAt,
  b.UpdatedAt,
  b.RowVer,
  b.CheckedInAt,
  b.CheckedOutAt,
  b.Channel
`;

const BOOKING_FROM = `
  FROM dbo.Bookings b
  INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
  INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
  INNER JOIN dbo.Sports sp ON sp.SportId = c.SportId
  LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
  LEFT JOIN dbo.Users cb ON cb.UserId = b.CanceledBy
`;

export interface DailyPaymentRow {
  bookingId: number;
  method: PaymentMethod;
  purpose: PaymentPurpose;
  amount: number;
  bookingStatus: BookingStatus;
  bookingPaymentStatus: PaymentStatus;
  bookingPaymentOption: PaymentOption;
}

export interface DailyCanceledRefundRow {
  bookingId: number;
  refundAmount: number;
  paidAmount: number;
  depositAmount: number;
  paymentOption: PaymentOption;
}

export interface BookingMethodTotalRow {
  bookingId: number;
  method: PaymentMethod;
  totalAmount: number;
}

export interface DashboardCourtRow {
  courtId: number;
  code: string;
  name: string;
  branchId: number;
  branchName: string;
  courtStatus: CourtStatus;
}

export interface DashboardCourtBlockRow {
  blockId: number;
  courtId: number;
  blockType: BlockType;
  startAt: Date;
  endAt: Date | null;
  reason: string;
}

export interface RevenueDrilldownBookingRow extends BookingRow {
  CollectedOnDate: number | string;
  RefundedOnDate: number | string;
}

@Injectable()
export class DashboardRepository {
  async listBranchIdsInScope(exec: DbExecutor, branchId: number | null): Promise<number[]> {
    const req = exec.request();
    let whereSql = '';
    if (branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      whereSql = 'WHERE BranchId = @branchId';
    }
    const res = await req.query<{ BranchId: number }>(`
      SELECT BranchId
      FROM dbo.Branches
      ${whereSql}
      ORDER BY BranchId ASC
    `);
    return res.recordset.map((r) => Number(r.BranchId));
  }

  async listDayBookings(
    exec: DbExecutor,
    params: { branchId: number | null; dayStart: Date; nextDayStart: Date },
  ): Promise<BookingRow[]> {
    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(params.dayStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let branchFilter = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      branchFilter = 'AND b.BranchId = @branchId';
    }

    const res = await req.query<BookingRow>(`
      SELECT ${BOOKING_SELECT}
      ${BOOKING_FROM}
      WHERE b.StartAt >= @dayStart
        AND b.StartAt < @nextDayStart
        ${branchFilter}
      ORDER BY b.StartAt ASC, b.BookingId ASC
    `);
    return res.recordset;
  }

  async listDailyPayments(
    exec: DbExecutor,
    params: { branchId: number | null; dayStart: Date; nextDayStart: Date },
  ): Promise<DailyPaymentRow[]> {
    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(params.dayStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let branchFilter = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      branchFilter = 'AND b.BranchId = @branchId';
    }

    // SDD 3.5f: exclude BY_FACILITY bookings completely from revenue
    const res = await req.query<{
      BookingId: number | string;
      Method: PaymentMethod;
      Purpose: PaymentPurpose;
      Amount: number | string;
      BookingStatus: BookingStatus;
      BookingPaymentStatus: PaymentStatus;
      BookingPaymentOption: PaymentOption;
    }>(`
      SELECT
        p.BookingId,
        p.Method,
        p.Purpose,
        p.Amount,
        b.Status AS BookingStatus,
        b.PaymentStatus AS BookingPaymentStatus,
        b.PaymentOption AS BookingPaymentOption
      FROM dbo.Payments p
      INNER JOIN dbo.Bookings b ON b.BookingId = p.BookingId
      WHERE p.PaidAt >= @dayStart
        AND p.PaidAt < @nextDayStart
        AND (b.CancelType IS NULL OR b.CancelType <> 'BY_FACILITY')
        ${branchFilter}
    `);

    return res.recordset.map((r) => ({
      bookingId: Number(r.BookingId),
      method: r.Method,
      purpose: r.Purpose,
      amount: Number(r.Amount),
      bookingStatus: r.BookingStatus,
      bookingPaymentStatus: r.BookingPaymentStatus,
      bookingPaymentOption: r.BookingPaymentOption,
    }));
  }

  async listDailyCanceledRefunds(
    exec: DbExecutor,
    params: { branchId: number | null; dayStart: Date; nextDayStart: Date },
  ): Promise<DailyCanceledRefundRow[]> {
    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(params.dayStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let branchFilter = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      branchFilter = 'AND b.BranchId = @branchId';
    }

    // SDD 3.5f + Q-14: refund recognized on CanceledAt, excluding BY_FACILITY
    const res = await req.query<{
      BookingId: number | string;
      RefundAmount: number | string | null;
      PaidAmount: number | string;
      DepositAmount: number | string;
      PaymentOption: PaymentOption;
    }>(`
      SELECT
        b.BookingId,
        ISNULL(b.RefundAmount, 0) AS RefundAmount,
        b.PaidAmount,
        b.DepositAmount,
        b.PaymentOption
      FROM dbo.Bookings b
      WHERE b.Status = 'CANCELED'
        AND b.CancelType <> 'BY_FACILITY'
        AND b.CanceledAt >= @dayStart
        AND b.CanceledAt < @nextDayStart
        ${branchFilter}
    `);

    return res.recordset.map((r) => ({
      bookingId: Number(r.BookingId),
      refundAmount: Number(r.RefundAmount ?? 0),
      paidAmount: Number(r.PaidAmount),
      depositAmount: Number(r.DepositAmount),
      paymentOption: r.PaymentOption,
    }));
  }

  async getBookingPaymentTotalsByMethod(
    exec: DbExecutor,
    bookingIds: number[],
  ): Promise<BookingMethodTotalRow[]> {
    if (bookingIds.length === 0) {
      return [];
    }
    const req = exec.request();
    const paramNames: string[] = [];
    bookingIds.forEach((id, idx) => {
      const name = `bid${idx}`;
      req.input(name, sql.BigInt, id);
      paramNames.push(`@${name}`);
    });

    const res = await req.query<{
      BookingId: number | string;
      Method: PaymentMethod;
      TotalAmount: number | string;
    }>(`
      SELECT BookingId, Method, SUM(Amount) AS TotalAmount
      FROM dbo.Payments
      WHERE BookingId IN (${paramNames.join(',')})
      GROUP BY BookingId, Method
    `);

    return res.recordset.map((r) => ({
      bookingId: Number(r.BookingId),
      method: r.Method,
      totalAmount: Number(r.TotalAmount),
    }));
  }

  async listCourtsForBoard(
    exec: DbExecutor,
    branchId: number | null,
  ): Promise<DashboardCourtRow[]> {
    const req = exec.request();
    let branchFilter = '';
    if (branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      branchFilter = 'WHERE c.BranchId = @branchId';
    }

    const res = await req.query<{
      CourtId: number;
      Code: string;
      Name: string;
      BranchId: number;
      BranchName: string;
      CourtStatus: CourtStatus;
    }>(`
      SELECT
        c.CourtId,
        c.Code,
        c.Name,
        c.BranchId,
        br.Name AS BranchName,
        c.Status AS CourtStatus
      FROM dbo.Courts c
      INNER JOIN dbo.Branches br ON br.BranchId = c.BranchId
      ${branchFilter}
      ORDER BY c.BranchId ASC, c.CourtId ASC
    `);

    return res.recordset.map((r) => ({
      courtId: Number(r.CourtId),
      code: r.Code,
      name: r.Name,
      branchId: Number(r.BranchId),
      branchName: r.BranchName,
      courtStatus: r.CourtStatus,
    }));
  }

  async listDayCourtBlocks(
    exec: DbExecutor,
    params: { branchId: number | null; dayStart: Date; nextDayStart: Date },
  ): Promise<DashboardCourtBlockRow[]> {
    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(params.dayStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let branchFilter = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      branchFilter = 'AND c.BranchId = @branchId';
    }

    const res = await req.query<{
      BlockId: number | string;
      CourtId: number;
      BlockType: BlockType;
      StartAt: Date | string;
      EndAt: Date | string | null;
      Reason: string;
    }>(`
      SELECT cb.BlockId, cb.CourtId, cb.BlockType, cb.StartAt, cb.EndAt, cb.Reason
      FROM dbo.CourtBlocks cb
      INNER JOIN dbo.Courts c ON c.CourtId = cb.CourtId
      WHERE cb.ReleasedAt IS NULL
        AND cb.StartAt < @nextDayStart
        AND (cb.EndAt IS NULL OR cb.EndAt > @dayStart)
        ${branchFilter}
      ORDER BY cb.StartAt ASC, cb.BlockId ASC
    `);

    return res.recordset.map((r) => ({
      blockId: Number(r.BlockId),
      courtId: Number(r.CourtId),
      blockType: r.BlockType,
      startAt: fromSqlDateTime(r.StartAt),
      endAt: r.EndAt !== null ? fromSqlDateTime(r.EndAt) : null,
      reason: r.Reason,
    }));
  }

  async listRevenueDrilldownBookings(
    exec: DbExecutor,
    params: { branchId: number | null; dayStart: Date; nextDayStart: Date },
  ): Promise<RevenueDrilldownBookingRow[]> {
    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(params.dayStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let branchFilter = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      branchFilter = 'AND b.BranchId = @branchId';
    }

    const res = await req.query<RevenueDrilldownBookingRow>(`
      SELECT
        ${BOOKING_SELECT},
        ISNULL(payAgg.CollectedOnDate, 0) AS CollectedOnDate,
        CASE
          WHEN b.Status = 'CANCELED'
           AND b.CanceledAt >= @dayStart
           AND b.CanceledAt < @nextDayStart
          THEN ISNULL(b.RefundAmount, 0)
          ELSE 0
        END AS RefundedOnDate
      ${BOOKING_FROM}
      LEFT JOIN (
        SELECT BookingId, SUM(Amount) AS CollectedOnDate
        FROM dbo.Payments
        WHERE PaidAt >= @dayStart
          AND PaidAt < @nextDayStart
        GROUP BY BookingId
      ) payAgg ON payAgg.BookingId = b.BookingId
      WHERE (b.CancelType IS NULL OR b.CancelType <> 'BY_FACILITY')
        ${branchFilter}
        AND (
          payAgg.CollectedOnDate IS NOT NULL
          OR (
            b.Status = 'CANCELED'
            AND b.CanceledAt >= @dayStart
            AND b.CanceledAt < @nextDayStart
            AND ISNULL(b.RefundAmount, 0) > 0
          )
        )
      ORDER BY b.StartAt ASC, b.BookingId ASC
    `);

    return res.recordset;
  }
}
