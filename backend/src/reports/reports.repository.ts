import { Injectable } from '@nestjs/common';
import type {
  BookingStatus,
  BranchStatus,
  CancelType,
  CourtStatus,
  PaymentMethod,
} from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import type { DbExecutor } from '../core/db/transaction.js';
import {
  fromSqlDate,
  fromSqlDateTime,
  fromSqlTime,
  toSqlDate,
  toSqlDateTime,
} from '../core/time.js';

export interface ReportBranchRow {
  branchId: number;
  code: string;
  name: string;
  status: BranchStatus;
}

export interface ReportCourtRow {
  courtId: number;
  code: string;
  name: string;
  status: CourtStatus;
  branchId: number;
  branchCode: string;
  branchName: string;
  branchStatus: BranchStatus;
}

export interface ReportOpeningHourRow {
  branchId: number;
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface ReportHolidayRow {
  branchId: number;
  startDate: string;
  endDate: string;
}

export interface ReportBookingRow {
  bookingId: number;
  branchId: number;
  courtId: number;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
  cancelType: CancelType | null;
  promotionCode: string | null;
  discountAmount: number;
  paidAmount: number;
}

export interface ReportPaymentRow {
  paymentId: number;
  bookingId: number;
  branchId: number;
  courtId: number;
  method: PaymentMethod;
  amount: number;
  bookingStatus: BookingStatus;
}

export interface ReportCanceledRefundRow {
  bookingId: number;
  branchId: number;
  courtId: number;
  refundAmount: number;
}

export interface ReportBookingMethodTotalRow {
  bookingId: number;
  method: PaymentMethod;
  totalAmount: number;
}

@Injectable()
export class ReportsRepository {
  async listBranchesInScope(
    exec: DbExecutor,
    branchId: number | null,
  ): Promise<ReportBranchRow[]> {
    const req = exec.request();
    let whereSql = '';
    if (branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      whereSql = 'WHERE BranchId = @branchId';
    }

    const res = await req.query<{
      BranchId: number;
      Code: string;
      Name: string;
      Status: BranchStatus;
    }>(`
      SELECT BranchId, Code, Name, Status
      FROM dbo.Branches
      ${whereSql}
      ORDER BY BranchId ASC
    `);

    return res.recordset.map((r) => ({
      branchId: Number(r.BranchId),
      code: r.Code,
      name: r.Name,
      status: r.Status,
    }));
  }

  async listCourtsInScope(
    exec: DbExecutor,
    branchId: number | null,
    courtId: number | null,
  ): Promise<ReportCourtRow[]> {
    const req = exec.request();
    const conditions: string[] = [];
    if (branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      conditions.push('c.BranchId = @branchId');
    }
    if (courtId !== null) {
      req.input('courtId', sql.Int, courtId);
      conditions.push('c.CourtId = @courtId');
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const res = await req.query<{
      CourtId: number;
      Code: string;
      Name: string;
      Status: CourtStatus;
      BranchId: number;
      BranchCode: string;
      BranchName: string;
      BranchStatus: BranchStatus;
    }>(`
      SELECT
        c.CourtId,
        c.Code,
        c.Name,
        c.Status,
        c.BranchId,
        br.Code AS BranchCode,
        br.Name AS BranchName,
        br.Status AS BranchStatus
      FROM dbo.Courts c
      INNER JOIN dbo.Branches br ON br.BranchId = c.BranchId
      ${whereSql}
      ORDER BY c.BranchId ASC, c.CourtId ASC
    `);

    return res.recordset.map((r) => ({
      courtId: Number(r.CourtId),
      code: r.Code,
      name: r.Name,
      status: r.Status,
      branchId: Number(r.BranchId),
      branchCode: r.BranchCode,
      branchName: r.BranchName,
      branchStatus: r.BranchStatus,
    }));
  }

  async listOpeningHours(
    exec: DbExecutor,
    branchId: number | null,
  ): Promise<ReportOpeningHourRow[]> {
    const req = exec.request();
    let whereSql = '';
    if (branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      whereSql = 'WHERE BranchId = @branchId';
    }

    const res = await req.query<{
      BranchId: number;
      DayOfWeek: number;
      OpenTime: Date | string | null;
      CloseTime: Date | string | null;
      IsClosed: boolean | number;
    }>(`
      SELECT BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed
      FROM dbo.BranchOpeningHours
      ${whereSql}
    `);

    return res.recordset.map((r) => ({
      branchId: Number(r.BranchId),
      dayOfWeek: Number(r.DayOfWeek),
      openTime: r.OpenTime !== null ? fromSqlTime(r.OpenTime) : null,
      closeTime: r.CloseTime !== null ? fromSqlTime(r.CloseTime) : null,
      isClosed: Boolean(r.IsClosed),
    }));
  }

  async listHolidaysInRange(
    exec: DbExecutor,
    branchId: number | null,
    fromDate: string,
    toDate: string,
  ): Promise<ReportHolidayRow[]> {
    const req = exec
      .request()
      .input('fromDate', sql.Date, toSqlDate(fromDate))
      .input('toDate', sql.Date, toSqlDate(toDate));

    let branchFilter = '';
    if (branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      branchFilter = 'AND BranchId = @branchId';
    }

    const res = await req.query<{
      BranchId: number;
      StartDate: Date | string;
      EndDate: Date | string;
    }>(`
      SELECT BranchId, StartDate, EndDate
      FROM dbo.BranchHolidays
      WHERE StartDate <= @toDate
        AND EndDate >= @fromDate
        ${branchFilter}
    `);

    return res.recordset.map((r) => ({
      branchId: Number(r.BranchId),
      startDate: fromSqlDate(r.StartDate),
      endDate: fromSqlDate(r.EndDate),
    }));
  }

  async listBookingsInPeriod(
    exec: DbExecutor,
    params: {
      branchId: number | null;
      courtId: number | null;
      fromStart: Date;
      nextDayStart: Date;
    },
  ): Promise<ReportBookingRow[]> {
    const req = exec
      .request()
      .input('fromStart', sql.DateTime2(0), toSqlDateTime(params.fromStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let scopeSql = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      scopeSql += ' AND b.BranchId = @branchId';
    }
    if (params.courtId !== null) {
      req.input('courtId', sql.Int, params.courtId);
      scopeSql += ' AND b.CourtId = @courtId';
    }

    const res = await req.query<{
      BookingId: number | string;
      BranchId: number;
      CourtId: number;
      StartAt: Date | string;
      EndAt: Date | string;
      Status: BookingStatus;
      CancelType: CancelType | null;
      PromotionCode: string | null;
      DiscountAmount: number | string;
      PaidAmount: number | string;
    }>(`
      SELECT
        b.BookingId,
        b.BranchId,
        b.CourtId,
        b.StartAt,
        b.EndAt,
        b.Status,
        b.CancelType,
        b.PromotionCode,
        b.DiscountAmount,
        b.PaidAmount
      FROM dbo.Bookings b
      WHERE b.StartAt >= @fromStart
        AND b.StartAt < @nextDayStart
        ${scopeSql}
    `);

    return res.recordset.map((r) => ({
      bookingId: Number(r.BookingId),
      branchId: Number(r.BranchId),
      courtId: Number(r.CourtId),
      startAt: fromSqlDateTime(r.StartAt),
      endAt: fromSqlDateTime(r.EndAt),
      status: r.Status,
      cancelType: r.CancelType,
      promotionCode: r.PromotionCode,
      discountAmount: Number(r.DiscountAmount),
      paidAmount: Number(r.PaidAmount),
    }));
  }

  async listPaymentsInPeriod(
    exec: DbExecutor,
    params: {
      branchId: number | null;
      courtId: number | null;
      fromStart: Date;
      nextDayStart: Date;
    },
  ): Promise<ReportPaymentRow[]> {
    const req = exec
      .request()
      .input('fromStart', sql.DateTime2(0), toSqlDateTime(params.fromStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let scopeSql = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      scopeSql += ' AND b.BranchId = @branchId';
    }
    if (params.courtId !== null) {
      req.input('courtId', sql.Int, params.courtId);
      scopeSql += ' AND b.CourtId = @courtId';
    }

    // SDD 3.5f: exclude BY_FACILITY bookings completely from revenue
    const res = await req.query<{
      PaymentId: number | string;
      BookingId: number | string;
      BranchId: number;
      CourtId: number;
      Method: PaymentMethod;
      Amount: number | string;
      BookingStatus: BookingStatus;
    }>(`
      SELECT
        p.PaymentId,
        p.BookingId,
        b.BranchId,
        b.CourtId,
        p.Method,
        p.Amount,
        b.Status AS BookingStatus
      FROM dbo.Payments p
      INNER JOIN dbo.Bookings b ON b.BookingId = p.BookingId
      WHERE p.PaidAt >= @fromStart
        AND p.PaidAt < @nextDayStart
        AND (b.CancelType IS NULL OR b.CancelType <> 'BY_FACILITY')
        ${scopeSql}
    `);

    return res.recordset.map((r) => ({
      paymentId: Number(r.PaymentId),
      bookingId: Number(r.BookingId),
      branchId: Number(r.BranchId),
      courtId: Number(r.CourtId),
      method: r.Method,
      amount: Number(r.Amount),
      bookingStatus: r.BookingStatus,
    }));
  }

  async listCanceledRefundsInPeriod(
    exec: DbExecutor,
    params: {
      branchId: number | null;
      courtId: number | null;
      fromStart: Date;
      nextDayStart: Date;
    },
  ): Promise<ReportCanceledRefundRow[]> {
    const req = exec
      .request()
      .input('fromStart', sql.DateTime2(0), toSqlDateTime(params.fromStart))
      .input('nextDayStart', sql.DateTime2(0), toSqlDateTime(params.nextDayStart));

    let scopeSql = '';
    if (params.branchId !== null) {
      req.input('branchId', sql.Int, params.branchId);
      scopeSql += ' AND b.BranchId = @branchId';
    }
    if (params.courtId !== null) {
      req.input('courtId', sql.Int, params.courtId);
      scopeSql += ' AND b.CourtId = @courtId';
    }

    // SDD 3.5f + Q-14: refund recognized on CanceledAt, excluding BY_FACILITY
    const res = await req.query<{
      BookingId: number | string;
      BranchId: number;
      CourtId: number;
      RefundAmount: number | string | null;
    }>(`
      SELECT
        b.BookingId,
        b.BranchId,
        b.CourtId,
        ISNULL(b.RefundAmount, 0) AS RefundAmount
      FROM dbo.Bookings b
      WHERE b.Status = 'CANCELED'
        AND b.CancelType <> 'BY_FACILITY'
        AND b.CanceledAt >= @fromStart
        AND b.CanceledAt < @nextDayStart
        ${scopeSql}
    `);

    return res.recordset.map((r) => ({
      bookingId: Number(r.BookingId),
      branchId: Number(r.BranchId),
      courtId: Number(r.CourtId),
      refundAmount: Number(r.RefundAmount ?? 0),
    }));
  }

  async getBookingPaymentTotalsByMethod(
    exec: DbExecutor,
    bookingIds: number[],
  ): Promise<ReportBookingMethodTotalRow[]> {
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
}
