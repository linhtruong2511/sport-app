import { Injectable } from '@nestjs/common';
import type { BlockType, BranchStatus, CourtStatus } from '@sporthub/shared/enums';
import type { BookingRow } from '../bookings/bookings.mapper.js';
import { sql } from '../config/database.js';
import type { DbExecutor, TxContext } from '../core/db/transaction.js';
import { fromSqlDate, fromSqlDateTime, fromSqlTime, toSqlDate, toSqlDateTime } from '../core/time.js';

export interface ActiveCourtBlockRow {
  blockId: number;
  courtId: number;
  courtName: string;
  blockType: BlockType;
  startAt: Date;
  endAt: Date | null;
  reason: string;
}

export interface HolidaySpanRow {
  holidayId: number;
  branchId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export interface BranchOpeningRow {
  branchId: number;
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface CourtStatusRow {
  courtId: number;
  branchId: number;
  sportId: number;
  code: string;
  name: string;
  status: CourtStatus;
  branchStatus: BranchStatus;
  gridBlockMinutes: number;
}

export interface CandidateCourtRow {
  courtId: number;
  code: string;
  name: string;
}

@Injectable()
export class AffectedBookingsRepository {
  async listOpenFutureBookings(
    exec: DbExecutor,
    now: Date,
    branchId?: number | null,
    courtId?: number | null,
  ): Promise<BookingRow[]> {
    const req = exec.request().input('now', sql.DateTime2(0), toSqlDateTime(now));
    let filterSql = '';
    if (branchId !== undefined && branchId !== null) {
      req.input('branchId', sql.Int, branchId);
      filterSql += ' AND b.BranchId = @branchId';
    }
    if (courtId !== undefined && courtId !== null) {
      req.input('courtId', sql.Int, courtId);
      filterSql += ' AND b.CourtId = @courtId';
    }

    const res = await req.query<BookingRow>(`
      SELECT
        b.BookingId, b.BookingCode, b.BranchId, br.Name AS BranchName, br.Address AS BranchAddress,
        b.CourtId, c.Code AS CourtCode, c.Name AS CourtName, sp.Code AS SportCode, sp.Name AS SportName,
        b.CustomerUserId, cu.FullName AS CustomerUserName, cu.Phone AS CustomerUserPhone,
        b.GuestName, b.GuestPhone, b.StartAt, b.EndAt,
        b.BaseAmount, b.DiscountAmount, b.TotalAmount,
        b.PaymentOption, b.DepositType, b.DepositValue, b.DepositAmount,
        b.AmountDueNow, b.PaidAmount, b.RemainingAmount,
        b.Status, b.PaymentStatus, b.HoldExpireAt, b.PromotionCode,
        b.CanceledBy, cb.FullName AS CanceledByName, b.CanceledAt, b.CancelReason, b.CancelType,
        b.RefundRate, b.RefundAmount, b.ReminderSentAt, b.Note,
        b.CreatedBy, b.CreatedAt, b.UpdatedAt, b.RowVer, b.CheckedInAt, b.CheckedOutAt, b.Channel
      FROM dbo.Bookings b
      INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
      INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
      INNER JOIN dbo.Sports sp ON sp.SportId = c.SportId
      LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
      LEFT JOIN dbo.Users cb ON cb.UserId = b.CanceledBy
      WHERE b.Status IN ('PENDING_PAYMENT', 'CONFIRMED')
        AND b.StartAt >= @now
        ${filterSql}
      ORDER BY b.StartAt ASC, b.BookingId ASC
    `);

    return res.recordset;
  }

  async listUnreleasedBlocks(
    exec: DbExecutor,
    branchId?: number | null,
  ): Promise<ActiveCourtBlockRow[]> {
    const req = exec.request();
    const filterSql =
      branchId !== undefined && branchId !== null ? 'AND c.BranchId = @branchId' : '';
    if (branchId !== undefined && branchId !== null) {
      req.input('branchId', sql.Int, branchId);
    }

    const res = await req.query<{
      BlockId: number | string;
      CourtId: number;
      CourtName: string;
      BlockType: BlockType;
      StartAt: Date | string;
      EndAt: Date | string | null;
      Reason: string;
    }>(`
      SELECT cb.BlockId, cb.CourtId, c.Name AS CourtName, cb.BlockType, cb.StartAt, cb.EndAt, cb.Reason
      FROM dbo.CourtBlocks cb
      INNER JOIN dbo.Courts c ON c.CourtId = cb.CourtId
      WHERE cb.ReleasedAt IS NULL
        ${filterSql}
    `);

    return res.recordset.map((r) => ({
      blockId: Number(r.BlockId),
      courtId: Number(r.CourtId),
      courtName: r.CourtName,
      blockType: r.BlockType,
      startAt: fromSqlDateTime(r.StartAt),
      endAt: r.EndAt !== null ? fromSqlDateTime(r.EndAt) : null,
      reason: r.Reason,
    }));
  }

  async listHolidays(exec: DbExecutor, branchId?: number | null): Promise<HolidaySpanRow[]> {
    const req = exec.request();
    const filterSql =
      branchId !== undefined && branchId !== null ? 'WHERE BranchId = @branchId' : '';
    if (branchId !== undefined && branchId !== null) {
      req.input('branchId', sql.Int, branchId);
    }

    const res = await req.query<{
      HolidayId: number;
      BranchId: number;
      StartDate: Date | string;
      EndDate: Date | string;
      Reason: string | null;
    }>(`
      SELECT HolidayId, BranchId, StartDate, EndDate, Reason
      FROM dbo.BranchHolidays
      ${filterSql}
    `);

    return res.recordset.map((r) => ({
      holidayId: Number(r.HolidayId),
      branchId: Number(r.BranchId),
      startDate: fromSqlDate(r.StartDate),
      endDate: fromSqlDate(r.EndDate),
      reason: r.Reason ?? null,
    }));
  }

  async listOpeningHours(exec: DbExecutor, branchId?: number | null): Promise<BranchOpeningRow[]> {
    const req = exec.request();
    const filterSql =
      branchId !== undefined && branchId !== null ? 'WHERE BranchId = @branchId' : '';
    if (branchId !== undefined && branchId !== null) {
      req.input('branchId', sql.Int, branchId);
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
      ${filterSql}
    `);

    return res.recordset.map((r) => ({
      branchId: Number(r.BranchId),
      dayOfWeek: Number(r.DayOfWeek),
      openTime: r.OpenTime !== null ? fromSqlTime(r.OpenTime) : null,
      closeTime: r.CloseTime !== null ? fromSqlTime(r.CloseTime) : null,
      isClosed: Boolean(r.IsClosed),
    }));
  }

  async listCourtsStatus(exec: DbExecutor, branchId?: number | null): Promise<CourtStatusRow[]> {
    const req = exec.request();
    const filterSql =
      branchId !== undefined && branchId !== null ? 'WHERE c.BranchId = @branchId' : '';
    if (branchId !== undefined && branchId !== null) {
      req.input('branchId', sql.Int, branchId);
    }

    const res = await req.query<{
      CourtId: number;
      BranchId: number;
      SportId: number;
      Code: string;
      Name: string;
      Status: CourtStatus;
      BranchStatus: BranchStatus;
      GridBlockMinutes: number;
    }>(`
      SELECT c.CourtId, c.BranchId, c.SportId, c.Code, c.Name, c.Status,
             b.Status AS BranchStatus, s.GridBlockMinutes
      FROM dbo.Courts c
      INNER JOIN dbo.Branches b ON b.BranchId = c.BranchId
      INNER JOIN dbo.Sports s ON s.SportId = c.SportId
      ${filterSql}
    `);

    return res.recordset.map((r) => ({
      courtId: Number(r.CourtId),
      branchId: Number(r.BranchId),
      sportId: Number(r.SportId),
      code: r.Code,
      name: r.Name,
      status: r.Status,
      branchStatus: r.BranchStatus,
      gridBlockMinutes: Number(r.GridBlockMinutes),
    }));
  }

  async findCourtInfo(exec: DbExecutor, courtId: number): Promise<CourtStatusRow | null> {
    const res = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .query<{
        CourtId: number;
        BranchId: number;
        SportId: number;
        Code: string;
        Name: string;
        Status: CourtStatus;
        BranchStatus: BranchStatus;
        GridBlockMinutes: number;
      }>(`
        SELECT c.CourtId, c.BranchId, c.SportId, c.Code, c.Name, c.Status,
               b.Status AS BranchStatus, s.GridBlockMinutes
        FROM dbo.Courts c
        INNER JOIN dbo.Branches b ON b.BranchId = c.BranchId
        INNER JOIN dbo.Sports s ON s.SportId = c.SportId
        WHERE c.CourtId = @courtId
      `);

    const r = res.recordset[0];
    if (!r) return null;
    return {
      courtId: Number(r.CourtId),
      branchId: Number(r.BranchId),
      sportId: Number(r.SportId),
      code: r.Code,
      name: r.Name,
      status: r.Status,
      branchStatus: r.BranchStatus,
      gridBlockMinutes: Number(r.GridBlockMinutes),
    };
  }

  async findReassignCandidateCourts(
    exec: DbExecutor,
    params: {
      branchId: number;
      sportId: number;
      excludeBookingId: number;
      excludeCourtId: number | null;
      startAt: Date;
      endAt: Date;
    },
  ): Promise<CandidateCourtRow[]> {
    const req = exec
      .request()
      .input('branchId', sql.Int, params.branchId)
      .input('sportId', sql.Int, params.sportId)
      .input('excludeBookingId', sql.BigInt, params.excludeBookingId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(params.startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(params.endAt));

    let excludeCourtSql = '';
    if (params.excludeCourtId !== null) {
      req.input('excludeCourtId', sql.Int, params.excludeCourtId);
      excludeCourtSql = 'AND c.CourtId <> @excludeCourtId';
    }

    const res = await req.query<{ CourtId: number; Code: string; Name: string }>(`
      SELECT c.CourtId, c.Code, c.Name
      FROM dbo.Courts c
      WHERE c.BranchId = @branchId
        AND c.SportId = @sportId
        AND c.Status = 'ACTIVE'
        ${excludeCourtSql}
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CourtBlocks cb
          WHERE cb.CourtId = c.CourtId
            AND cb.ReleasedAt IS NULL
            AND cb.StartAt < @endAt
            AND (cb.EndAt IS NULL OR cb.EndAt > @startAt)
        )
        AND NOT EXISTS (
          SELECT 1 FROM dbo.BookingSlots bs
          WHERE bs.CourtId = c.CourtId
            AND bs.IsActive = 1
            AND bs.BookingId <> @excludeBookingId
            AND bs.SlotStart >= @startAt
            AND bs.SlotStart < @endAt
        )
      ORDER BY c.CourtId ASC
    `);

    return res.recordset.map((r) => ({
      courtId: Number(r.CourtId),
      code: r.Code,
      name: r.Name,
    }));
  }

  async hasHolidayOnDate(exec: DbExecutor, branchId: number, dateStr: string): Promise<boolean> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('date', sql.Date, toSqlDate(dateStr))
      .query<{ HolidayId: number }>(`
        SELECT TOP 1 HolidayId
        FROM dbo.BranchHolidays
        WHERE BranchId = @branchId AND StartDate <= @date AND EndDate >= @date
      `);
    return res.recordset.length > 0;
  }

  async getBranchOpeningForDay(
    exec: DbExecutor,
    branchId: number,
    dayOfWeek: number,
  ): Promise<BranchOpeningRow | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .query<{
        BranchId: number;
        DayOfWeek: number;
        OpenTime: Date | string | null;
        CloseTime: Date | string | null;
        IsClosed: boolean | number;
      }>(`
        SELECT BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed
        FROM dbo.BranchOpeningHours
        WHERE BranchId = @branchId AND DayOfWeek = @dayOfWeek
      `);

    const r = res.recordset[0];
    if (!r) return null;
    return {
      branchId: Number(r.BranchId),
      dayOfWeek: Number(r.DayOfWeek),
      openTime: r.OpenTime !== null ? fromSqlTime(r.OpenTime) : null,
      closeTime: r.CloseTime !== null ? fromSqlTime(r.CloseTime) : null,
      isClosed: Boolean(r.IsClosed),
    };
  }

  async hasActiveBlockInWindow(
    exec: DbExecutor,
    courtId: number,
    startAt: Date,
    endAt: Date,
  ): Promise<boolean> {
    const res = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .query<{ BlockId: number | string }>(`
        SELECT TOP 1 BlockId
        FROM dbo.CourtBlocks
        WHERE CourtId = @courtId
          AND ReleasedAt IS NULL
          AND StartAt < @endAt
          AND (EndAt IS NULL OR EndAt > @startAt)
      `);
    return res.recordset.length > 0;
  }

  async insertBookingTransfer(
    tx: TxContext,
    input: {
      bookingId: number;
      oldCourtId: number;
      oldStartAt: Date;
      oldEndAt: Date;
      newCourtId: number;
      newStartAt: Date;
      newEndAt: Date;
      performedBy: number;
      note: string | null;
      now: Date;
    },
  ): Promise<number> {
    const res = await tx
      .request()
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('oldCourtId', sql.Int, input.oldCourtId)
      .input('oldStartAt', sql.DateTime2(0), toSqlDateTime(input.oldStartAt))
      .input('oldEndAt', sql.DateTime2(0), toSqlDateTime(input.oldEndAt))
      .input('newCourtId', sql.Int, input.newCourtId)
      .input('newStartAt', sql.DateTime2(0), toSqlDateTime(input.newStartAt))
      .input('newEndAt', sql.DateTime2(0), toSqlDateTime(input.newEndAt))
      .input('performedBy', sql.BigInt, input.performedBy)
      .input('note', sql.NVarChar(255), input.note)
      .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
      .query<{ TransferId: number | string }>(`
        INSERT INTO dbo.BookingTransfers (
          BookingId, OldCourtId, OldStartAt, OldEndAt,
          NewCourtId, NewStartAt, NewEndAt, PerformedBy, Note, PerformedAt
        )
        OUTPUT inserted.TransferId
        VALUES (
          @bookingId, @oldCourtId, @oldStartAt, @oldEndAt,
          @newCourtId, @newStartAt, @newEndAt, @performedBy, @note, @now
        )
      `);

    return Number(res.recordset[0].TransferId);
  }
}
