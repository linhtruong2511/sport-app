import { Injectable } from '@nestjs/common';
import type {
  AudienceType,
  BranchStatus,
  CourtStatus,
  DepositType,
  DiscountType,
  PromotionStatus,
} from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import { type DbExecutor, DbTransactionService } from '../core/db/transaction.js';
import { fromSqlDate, fromSqlDateTime, fromSqlTime, toSqlDate, toSqlDateTime } from '../core/time.js';
import type { PriceRuleInput } from './pricing.engine.js';

export interface CourtQuoteContext {
  courtId: number;
  courtCode: string;
  courtName: string;
  branchId: number;
  branchName: string;
  branchStatus: BranchStatus;
  sportId: number;
  sportCode: string;
  gridBlockMinutes: number;
  depositType: DepositType;
  depositValue: number;
  courtStatus: CourtStatus;
}

export interface BranchOpeningHourRow {
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface PromotionQuoteRecord {
  promotionId: number;
  code: string;
  name: string;
  status: PromotionStatus;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  startDate: string;
  endDate: string;
  timeFrom: string | null;
  timeTo: string | null;
  allBranches: boolean;
  allSports: boolean;
  audienceType: AudienceType;
  maxUses: number;
  usedCount: number;
  isBranchEligible: boolean;
  isSportEligible: boolean;
  isCustomerEligible: boolean;
}

function floorToSqlSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1_000) * 1_000);
}

@Injectable()
export class PricingRepository {
  constructor(private readonly db: DbTransactionService) {}

  async findCourtContext(courtId: number, exec?: DbExecutor): Promise<CourtQuoteContext | null> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
      .request()
      .input('courtId', sql.Int, courtId)
      .query<{
        CourtId: number;
        CourtCode: string;
        CourtName: string;
        BranchId: number;
        BranchName: string;
        BranchStatus: BranchStatus;
        SportId: number;
        SportCode: string;
        GridBlockMinutes: number;
        DepositType: DepositType;
        DepositValue: number;
        CourtStatus: CourtStatus;
      }>(`
        SELECT
          c.CourtId,
          c.Code AS CourtCode,
          c.Name AS CourtName,
          c.BranchId,
          b.Name AS BranchName,
          b.Status AS BranchStatus,
          c.SportId,
          s.Code AS SportCode,
          s.GridBlockMinutes,
          c.DepositType,
          c.DepositValue,
          c.Status AS CourtStatus
        FROM dbo.Courts c
        JOIN dbo.Branches b ON b.BranchId = c.BranchId
        JOIN dbo.Sports s ON s.SportId = c.SportId
        WHERE c.CourtId = @courtId
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      courtId: Number(row.CourtId),
      courtCode: row.CourtCode,
      courtName: row.CourtName,
      branchId: Number(row.BranchId),
      branchName: row.BranchName,
      branchStatus: row.BranchStatus,
      sportId: Number(row.SportId),
      sportCode: row.SportCode,
      gridBlockMinutes: Number(row.GridBlockMinutes),
      depositType: row.DepositType,
      depositValue: Number(row.DepositValue),
      courtStatus: row.CourtStatus,
    };
  }

  async findBranchOpeningHour(
    branchId: number,
    dayOfWeek: number,
    exec?: DbExecutor,
  ): Promise<BranchOpeningHourRow | null> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
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
        WHERE BranchId = @branchId AND DayOfWeek = @dayOfWeek
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      openTime: row.OpenTime !== null ? fromSqlTime(row.OpenTime) : null,
      closeTime: row.CloseTime !== null ? fromSqlTime(row.CloseTime) : null,
      isClosed: Boolean(row.IsClosed),
    };
  }

  async hasBranchHoliday(branchId: number, dateStr: string, exec?: DbExecutor): Promise<boolean> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('date', sql.Date, toSqlDate(dateStr))
      .query<{ HolidayId: number }>(`
        SELECT TOP 1 HolidayId
        FROM dbo.BranchHolidays
        WHERE BranchId = @branchId
          AND StartDate <= @date
          AND EndDate >= @date
      `);

    return res.recordset.length > 0;
  }

  async findActivePriceRules(
    courtId: number,
    now: Date,
    exec?: DbExecutor,
  ): Promise<PriceRuleInput[]> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
      .request()
      .input('courtId', sql.Int, courtId)
      .input('now', sql.DateTime2(0), toSqlDateTime(floorToSqlSecond(now)))
      .query<{
        PriceRuleId: number | string;
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
          Label,
          DayOfWeekMask,
          StartTime,
          EndTime,
          PricePerHour,
          EffectiveFrom,
          EffectiveTo
        FROM dbo.CourtPriceRules
        WHERE CourtId = @courtId
          AND EffectiveFrom <= @now
          AND (EffectiveTo IS NULL OR EffectiveTo > @now)
        ORDER BY StartTime ASC
      `);

    return res.recordset.map((row) => ({
      priceRuleId: Number(row.PriceRuleId),
      label: row.Label,
      dayOfWeekMask: Number(row.DayOfWeekMask),
      startTime: fromSqlTime(row.StartTime),
      endTime: fromSqlTime(row.EndTime),
      pricePerHour: Number(row.PricePerHour),
      effectiveFrom: fromSqlDateTime(row.EffectiveFrom),
      effectiveTo: row.EffectiveTo !== null ? fromSqlDateTime(row.EffectiveTo) : null,
    }));
  }

  async hasOverlappingCourtBlock(
    courtId: number,
    startAt: Date,
    endAt: Date,
    exec?: DbExecutor,
  ): Promise<boolean> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
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

  async hasOverlappingBookingSlot(
    courtId: number,
    startAt: Date,
    endAt: Date,
    exec?: DbExecutor,
  ): Promise<boolean> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
      .request()
      .input('courtId', sql.Int, courtId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .query<{ BookingId: number | string }>(`
        SELECT TOP 1 BookingId
        FROM dbo.BookingSlots
        WHERE CourtId = @courtId
          AND IsActive = 1
          AND SlotStart >= @startAt
          AND SlotStart < @endAt
      `);

    return res.recordset.length > 0;
  }

  async findCustomerIdByPhone(phone: string, exec?: DbExecutor): Promise<number | null> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
      .request()
      .input('phone', sql.VarChar(10), phone)
      .query<{ UserId: number | string }>(`
        SELECT UserId
        FROM dbo.Users
        WHERE Phone = @phone AND Role = 'CUSTOMER'
      `);

    const row = res.recordset[0];
    return row ? Number(row.UserId) : null;
  }

  async findPromotionForQuote(
    code: string,
    branchId: number,
    sportId: number,
    customerId: number | null,
    exec?: DbExecutor,
  ): Promise<PromotionQuoteRecord | null> {
    const dbExec = exec ?? (await this.db.executor());
    const res = await dbExec
      .request()
      .input('code', sql.VarChar(20), code)
      .input('branchId', sql.Int, branchId)
      .input('sportId', sql.Int, sportId)
      .input('customerId', sql.BigInt, customerId)
      .query<{
        PromotionId: number;
        Code: string;
        Name: string;
        Status: PromotionStatus;
        DiscountType: DiscountType;
        DiscountValue: number;
        MaxDiscountAmount: number | null;
        StartDate: Date | string;
        EndDate: Date | string;
        TimeFrom: Date | string | null;
        TimeTo: Date | string | null;
        AllBranches: boolean | number;
        AllSports: boolean | number;
        AudienceType: AudienceType;
        MaxUses: number;
        UsedCount: number;
        IsBranchEligible: boolean | number;
        IsSportEligible: boolean | number;
        IsCustomerEligible: boolean | number;
      }>(`
        SELECT
          p.PromotionId,
          p.Code,
          p.Name,
          p.Status,
          p.DiscountType,
          p.DiscountValue,
          p.MaxDiscountAmount,
          p.StartDate,
          p.EndDate,
          p.TimeFrom,
          p.TimeTo,
          p.AllBranches,
          p.AllSports,
          p.AudienceType,
          p.MaxUses,
          p.UsedCount,
          CASE WHEN EXISTS (
            SELECT 1 FROM dbo.PromotionBranches pb
            WHERE pb.PromotionId = p.PromotionId AND pb.BranchId = @branchId
          ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsBranchEligible,
          CASE WHEN EXISTS (
            SELECT 1 FROM dbo.PromotionSports ps
            WHERE ps.PromotionId = p.PromotionId AND ps.SportId = @sportId
          ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsSportEligible,
          CASE WHEN @customerId IS NOT NULL AND EXISTS (
            SELECT 1 FROM dbo.PromotionCustomers pc
            WHERE pc.PromotionId = p.PromotionId AND pc.CustomerId = @customerId
          ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsCustomerEligible
        FROM dbo.Promotions p
        WHERE p.Code = @code
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      promotionId: Number(row.PromotionId),
      code: row.Code,
      name: row.Name,
      status: row.Status,
      discountType: row.DiscountType,
      discountValue: Number(row.DiscountValue),
      maxDiscountAmount: row.MaxDiscountAmount !== null ? Number(row.MaxDiscountAmount) : null,
      startDate: fromSqlDate(row.StartDate),
      endDate: fromSqlDate(row.EndDate),
      timeFrom: row.TimeFrom !== null ? fromSqlTime(row.TimeFrom) : null,
      timeTo: row.TimeTo !== null ? fromSqlTime(row.TimeTo) : null,
      allBranches: Boolean(row.AllBranches),
      allSports: Boolean(row.AllSports),
      audienceType: row.AudienceType,
      maxUses: Number(row.MaxUses),
      usedCount: Number(row.UsedCount),
      isBranchEligible: Boolean(row.IsBranchEligible),
      isSportEligible: Boolean(row.IsSportEligible),
      isCustomerEligible: Boolean(row.IsCustomerEligible),
    };
  }
}
