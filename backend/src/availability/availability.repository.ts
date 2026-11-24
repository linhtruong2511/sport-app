import { Injectable } from '@nestjs/common';
import type { BlockType, BookingStatus, BranchStatus, DepositType } from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import type { DbExecutor } from '../core/db/transaction.js';
import { fromSqlDate, fromSqlDateTime, fromSqlTime, toSqlDate, toSqlDateTime } from '../core/time.js';
import type { PriceRuleInput } from '../pricing/pricing.engine.js';

export interface ActiveBranchRecord {
  branchId: number;
  name: string;
  address: string;
  status: BranchStatus;
}

export interface OpeningHoursRecord {
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface HolidayRecord {
  holidayId: number;
  startDate: string;
  endDate: string;
  reason: string | null;
}

export interface SportRecord {
  sportId: number;
  code: string;
  name: string;
  gridBlockMinutes: number;
  displayBlockMinutes: number;
}

export interface ActiveCourtRecord {
  courtId: number;
  sportId: number;
  code: string;
  name: string;
  depositType: DepositType;
  depositValue: number;
}

export interface CourtPriceRuleRecord extends PriceRuleInput {
  courtId: number;
}

export interface CourtBlockRecord {
  blockId: number;
  courtId: number;
  blockType: BlockType;
  startAt: Date;
  endAt: Date | null;
  reason: string;
}

export interface ActiveBookedSlotRecord {
  courtId: number;
  slotStart: Date;
  bookingId: number;
  customerUserId: number | null;
  status: BookingStatus;
}

function buildCourtIdInClause(courtIds: number[], request: ReturnType<DbExecutor['request']>): string {
  return courtIds
    .map((id, idx) => {
      const param = `courtId${idx}`;
      request.input(param, sql.Int, id);
      return `@${param}`;
    })
    .join(', ');
}

@Injectable()
export class AvailabilityRepository {
  async findActiveBranch(exec: DbExecutor, branchId: number): Promise<ActiveBranchRecord | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{
        BranchId: number;
        Name: string;
        Address: string;
        Status: BranchStatus;
      }>(`
        SELECT BranchId, Name, Address, Status
        FROM dbo.Branches
        WHERE BranchId = @branchId
          AND Status = 'ACTIVE'
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      branchId: row.BranchId,
      name: row.Name,
      address: row.Address,
      status: row.Status,
    };
  }

  async findOpeningHoursForDay(
    exec: DbExecutor,
    branchId: number,
    dayOfWeek: number,
  ): Promise<OpeningHoursRecord | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .query<{
        OpenTime: Date | string | null;
        CloseTime: Date | string | null;
        IsClosed: boolean | number;
      }>(`
        SELECT OpenTime, CloseTime, IsClosed
        FROM dbo.BranchOpeningHours
        WHERE BranchId = @branchId
          AND DayOfWeek = @dayOfWeek
      `);

    const row = res.recordset[0];
    if (!row) return null;

    const isClosed = Boolean(row.IsClosed);
    return {
      openTime: isClosed || row.OpenTime === null ? null : fromSqlTime(row.OpenTime),
      closeTime: isClosed || row.CloseTime === null ? null : fromSqlTime(row.CloseTime),
      isClosed,
    };
  }

  async findHolidayForDate(
    exec: DbExecutor,
    branchId: number,
    date: string,
  ): Promise<HolidayRecord | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('date', sql.Date, toSqlDate(date))
      .query<{
        HolidayId: number;
        StartDate: Date | string;
        EndDate: Date | string;
        Reason: string | null;
      }>(`
        SELECT TOP (1) HolidayId, StartDate, EndDate, Reason
        FROM dbo.BranchHolidays
        WHERE BranchId = @branchId
          AND StartDate <= @date
          AND EndDate >= @date
        ORDER BY HolidayId ASC
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      holidayId: row.HolidayId,
      startDate: fromSqlDate(row.StartDate),
      endDate: fromSqlDate(row.EndDate),
      reason: row.Reason,
    };
  }

  async findSport(exec: DbExecutor, sportId: number): Promise<SportRecord | null> {
    const res = await exec
      .request()
      .input('sportId', sql.Int, sportId)
      .query<{
        SportId: number;
        Code: string;
        Name: string;
        GridBlockMinutes: number;
        DisplayBlockMinutes: number;
      }>(`
        SELECT SportId, Code, Name, GridBlockMinutes, DisplayBlockMinutes
        FROM dbo.Sports
        WHERE SportId = @sportId
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      sportId: row.SportId,
      code: row.Code,
      name: row.Name,
      gridBlockMinutes: Number(row.GridBlockMinutes),
      displayBlockMinutes: Number(row.DisplayBlockMinutes),
    };
  }

  async findSportsByBranchActiveCourts(exec: DbExecutor, branchId: number): Promise<SportRecord[]> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{
        SportId: number;
        Code: string;
        Name: string;
        GridBlockMinutes: number;
        DisplayBlockMinutes: number;
      }>(`
        SELECT DISTINCT s.SportId, s.Code, s.Name, s.GridBlockMinutes, s.DisplayBlockMinutes, s.SortOrder
        FROM dbo.Sports s
        JOIN dbo.Courts c ON c.SportId = s.SportId
        WHERE c.BranchId = @branchId
          AND c.Status = 'ACTIVE'
        ORDER BY s.SortOrder ASC, s.SportId ASC
      `);

    return res.recordset.map((row) => ({
      sportId: row.SportId,
      code: row.Code,
      name: row.Name,
      gridBlockMinutes: Number(row.GridBlockMinutes),
      displayBlockMinutes: Number(row.DisplayBlockMinutes),
    }));
  }

  async findActiveCourts(
    exec: DbExecutor,
    branchId: number,
    sportId?: number,
  ): Promise<ActiveCourtRecord[]> {
    const req = exec.request().input('branchId', sql.Int, branchId);
    const sportFilter = sportId !== undefined ? 'AND SportId = @sportId' : '';
    if (sportId !== undefined) {
      req.input('sportId', sql.Int, sportId);
    }

    const res = await req.query<{
      CourtId: number;
      SportId: number;
      Code: string;
      Name: string;
      DepositType: DepositType;
      DepositValue: number | string;
    }>(`
      SELECT CourtId, SportId, Code, Name, DepositType, DepositValue
      FROM dbo.Courts
      WHERE BranchId = @branchId
        AND Status = 'ACTIVE'
        ${sportFilter}
      ORDER BY CourtId ASC
    `);

    return res.recordset.map((row) => ({
      courtId: row.CourtId,
      sportId: row.SportId,
      code: row.Code,
      name: row.Name,
      depositType: row.DepositType,
      depositValue: Number(row.DepositValue),
    }));
  }

  async findActivePriceRulesForCourts(
    exec: DbExecutor,
    courtIds: number[],
    now: Date,
  ): Promise<CourtPriceRuleRecord[]> {
    if (courtIds.length === 0) return [];

    const req = exec.request().input('now', sql.DateTime2(0), toSqlDateTime(now));
    const inClause = buildCourtIdInClause(courtIds, req);

    const res = await req.query<{
      PriceRuleId: number | string;
      CourtId: number;
      Label: string;
      DayOfWeekMask: number;
      StartTime: Date | string;
      EndTime: Date | string;
      PricePerHour: number | string;
      EffectiveFrom: Date | string;
      EffectiveTo: Date | string | null;
    }>(`
      SELECT
        PriceRuleId,
        CourtId,
        Label,
        DayOfWeekMask,
        StartTime,
        EndTime,
        PricePerHour,
        EffectiveFrom,
        EffectiveTo
      FROM dbo.CourtPriceRules
      WHERE CourtId IN (${inClause})
        AND EffectiveFrom <= @now
        AND (EffectiveTo IS NULL OR EffectiveTo > @now)
      ORDER BY CourtId ASC, StartTime ASC, PriceRuleId ASC
    `);

    return res.recordset.map((row) => ({
      priceRuleId: Number(row.PriceRuleId),
      courtId: row.CourtId,
      label: row.Label,
      dayOfWeekMask: Number(row.DayOfWeekMask),
      startTime: fromSqlTime(row.StartTime),
      endTime: fromSqlTime(row.EndTime),
      pricePerHour: Number(row.PricePerHour),
      effectiveFrom: fromSqlDateTime(row.EffectiveFrom),
      effectiveTo: row.EffectiveTo ? fromSqlDateTime(row.EffectiveTo) : null,
    }));
  }

  async findUnreleasedBlocksForCourts(
    exec: DbExecutor,
    courtIds: number[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<CourtBlockRecord[]> {
    if (courtIds.length === 0) return [];

    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(dayStart))
      .input('dayEnd', sql.DateTime2(0), toSqlDateTime(dayEnd));
    const inClause = buildCourtIdInClause(courtIds, req);

    const res = await req.query<{
      BlockId: number | string;
      CourtId: number;
      BlockType: BlockType;
      StartAt: Date | string;
      EndAt: Date | string | null;
      Reason: string;
    }>(`
      SELECT BlockId, CourtId, BlockType, StartAt, EndAt, Reason
      FROM dbo.CourtBlocks
      WHERE CourtId IN (${inClause})
        AND ReleasedAt IS NULL
        AND StartAt < @dayEnd
        AND (EndAt IS NULL OR EndAt > @dayStart)
      ORDER BY BlockId ASC
    `);

    return res.recordset.map((row) => ({
      blockId: Number(row.BlockId),
      courtId: row.CourtId,
      blockType: row.BlockType,
      startAt: fromSqlDateTime(row.StartAt),
      endAt: row.EndAt ? fromSqlDateTime(row.EndAt) : null,
      reason: row.Reason,
    }));
  }

  async findActiveBookedSlotsForCourts(
    exec: DbExecutor,
    courtIds: number[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<ActiveBookedSlotRecord[]> {
    if (courtIds.length === 0) return [];

    const req = exec
      .request()
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(dayStart))
      .input('dayEnd', sql.DateTime2(0), toSqlDateTime(dayEnd));
    const inClause = buildCourtIdInClause(courtIds, req);

    // Never select customer name/phone on public availability queries.
    const res = await req.query<{
      CourtId: number;
      SlotStart: Date | string;
      BookingId: number | string;
      CustomerUserId: number | string | null;
      Status: BookingStatus;
    }>(`
      SELECT
        bs.CourtId,
        bs.SlotStart,
        b.BookingId,
        b.CustomerUserId,
        b.Status
      FROM dbo.BookingSlots bs
      JOIN dbo.Bookings b ON b.BookingId = bs.BookingId
      WHERE bs.CourtId IN (${inClause})
        AND bs.IsActive = 1
        AND bs.SlotStart >= @dayStart
        AND bs.SlotStart < @dayEnd
        AND b.Status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_USE')
    `);

    return res.recordset.map((row) => ({
      courtId: row.CourtId,
      slotStart: fromSqlDateTime(row.SlotStart),
      bookingId: Number(row.BookingId),
      customerUserId: row.CustomerUserId !== null ? Number(row.CustomerUserId) : null,
      status: row.Status,
    }));
  }
}
