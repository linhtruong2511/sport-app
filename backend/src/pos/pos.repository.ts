import { Injectable } from '@nestjs/common';
import type {
  AudienceType,
  BlockType,
  BookingChannel,
  BookingStatus,
  BranchStatus,
  DiscountType,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  PromotionStatus,
} from '@sporthub/shared/enums';
import type { ReceiptDto } from '@sporthub/shared/types';
import type { BookingRow } from '../bookings/bookings.mapper.js';
import { sql } from '../config/database.js';
import type { DbExecutor } from '../core/db/transaction.js';
import {
  addDays,
  fromSqlDate,
  fromSqlDateTime,
  fromSqlTime,
  parseVnDateTime,
  toIsoVn,
  toSqlDate,
  toSqlDateTime,
  vnDayOfWeek,
} from '../core/time.js';
import type { PriceRuleInput } from '../pricing/pricing.engine.js';
import type { PosBookingTab } from './pos.schemas.js';

export interface PosCustomerRecord {
  userId: number;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  memberTier: string | null;
}

export interface PosScheduleCourtRecord {
  courtId: number;
  code: string;
  name: string;
  sportId: number;
  sportCode: string;
  sportName: string;
  gridBlockMinutes: number;
  displayBlockMinutes: number;
}

export interface PosSchedulePriceRule extends PriceRuleInput {
  courtId: number;
}

export interface PosScheduleBlockRecord {
  blockId: number;
  courtId: number;
  blockType: BlockType;
  startAt: Date;
  endAt: Date | null;
  reason: string;
}

export interface PosScheduleBookedSlotRecord {
  courtId: number;
  slotStart: Date;
  bookingId: number;
  bookingCode: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  totalAmount: number;
  startAt: Date;
  checkedInAt: Date | null;
  isGuest: boolean;
  customerName: string;
  customerPhone: string;
}

export interface PosScheduleData {
  branch: {
    branchId: number;
    name: string;
    status: BranchStatus;
  } | null;
  openingHour: {
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  } | null;
  holiday: {
    holidayId: number;
    startDate: string;
    endDate: string;
    reason: string | null;
  } | null;
  sport: {
    sportId: number;
    code: string;
    name: string;
    gridBlockMinutes: number;
    displayBlockMinutes: number;
  } | null;
  courts: PosScheduleCourtRecord[];
  priceRules: PosSchedulePriceRule[];
  blocks: PosScheduleBlockRecord[];
  bookedSlots: PosScheduleBookedSlotRecord[];
}

export interface PosPromotionRecord {
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
  isCustomerEligible: boolean;
  sportIds: number[];
}

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

function buildIntInClause(
  prefix: string,
  ids: number[],
  req: ReturnType<DbExecutor['request']>,
): string {
  return ids
    .map((id, idx) => {
      const param = `${prefix}${idx}`;
      req.input(param, sql.Int, id);
      return `@${param}`;
    })
    .join(', ');
}

@Injectable()
export class PosRepository {
  async findCustomerByPhone(exec: DbExecutor, phone: string): Promise<PosCustomerRecord | null> {
    const res = await exec
      .request()
      .input('phone', sql.VarChar(10), phone)
      .query<{
        UserId: number | string;
        Code: string;
        FullName: string;
        Phone: string;
        Email: string | null;
        MemberTier: string | null;
      }>(`
        SELECT UserId, Code, FullName, Phone, Email, MemberTier
        FROM dbo.Users
        WHERE Phone = @phone
          AND Role = 'CUSTOMER'
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      userId: Number(row.UserId),
      code: row.Code,
      fullName: row.FullName,
      phone: row.Phone,
      email: row.Email,
      memberTier: row.MemberTier,
    };
  }

  async findMemberById(exec: DbExecutor, userId: number): Promise<PosCustomerRecord | null> {
    const res = await exec
      .request()
      .input('userId', sql.BigInt, userId)
      .query<{
        UserId: number | string;
        Code: string;
        FullName: string;
        Phone: string;
        Email: string | null;
        MemberTier: string | null;
      }>(`
        SELECT UserId, Code, FullName, Phone, Email, MemberTier
        FROM dbo.Users
        WHERE UserId = @userId
          AND Role = 'CUSTOMER'
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      userId: Number(row.UserId),
      code: row.Code,
      fullName: row.FullName,
      phone: row.Phone,
      email: row.Email,
      memberTier: row.MemberTier,
    };
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

  async findLatestCounterReceipt(exec: DbExecutor, branchId: number): Promise<ReceiptDto | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<{
        PaymentCode: string;
        BookingCode: string;
        Purpose: PaymentPurpose;
        Method: PaymentMethod;
        Channel: BookingChannel;
        Amount: number | string;
        PaidAt: Date | string;
        CollectedByName: string | null;
        BranchName: string;
        CourtName: string;
        CustomerName: string | null;
        CustomerPhone: string | null;
        StartAt: Date | string;
        EndAt: Date | string;
      }>(`
        SELECT TOP 1
          p.PaymentCode,
          b.BookingCode,
          p.Purpose,
          p.Method,
          p.Channel,
          p.Amount,
          p.PaidAt,
          u.FullName AS CollectedByName,
          br.Name AS BranchName,
          c.Name AS CourtName,
          COALESCE(cu.FullName, b.GuestName) AS CustomerName,
          COALESCE(cu.Phone, b.GuestPhone) AS CustomerPhone,
          b.StartAt,
          b.EndAt
        FROM dbo.Payments p
        INNER JOIN dbo.Bookings b ON b.BookingId = p.BookingId
        INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
        INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
        LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
        LEFT JOIN dbo.Users u ON u.UserId = p.CollectedBy
        WHERE p.Channel = 'COUNTER'
          AND b.BranchId = @branchId
        ORDER BY p.PaidAt DESC, p.PaymentId DESC
      `);

    const row = res.recordset[0];
    if (!row) return null;

    return {
      paymentCode: row.PaymentCode,
      bookingCode: row.BookingCode,
      purpose: row.Purpose,
      method: row.Method,
      channel: row.Channel,
      amount: Number(row.Amount),
      paidAt: toIsoVn(fromSqlDateTime(row.PaidAt)),
      collectedByName: row.CollectedByName ?? null,
      branchName: row.BranchName,
      courtName: row.CourtName,
      customerName: row.CustomerName ?? '',
      customerPhone: row.CustomerPhone ?? '',
      startAt: toIsoVn(fromSqlDateTime(row.StartAt)),
      endAt: toIsoVn(fromSqlDateTime(row.EndAt)),
    };
  }

  async findActiveInUseBookingOnCourt(
    exec: DbExecutor,
    courtId: number,
    excludeBookingId: number,
  ): Promise<string | null> {
    const res = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .input('excludeId', sql.BigInt, excludeBookingId)
      .query<{ BookingCode: string }>(`
        SELECT TOP 1 BookingCode
        FROM dbo.Bookings
        WHERE CourtId = @courtId
          AND Status = 'IN_USE'
          AND BookingId <> @excludeId
      `);

    return res.recordset[0]?.BookingCode ?? null;
  }

  async listBranchBookingsByDate(
    exec: DbExecutor,
    params: {
      branchId: number;
      date: string;
      tab: PosBookingTab;
      q?: string;
      page: number;
      pageSize: number;
      now: Date;
      noShowGraceMinutes: number;
    },
  ): Promise<{
    rows: BookingRow[];
    totalItems: number;
    tabCounts: Record<PosBookingTab, number>;
  }> {
    const dayStart = parseVnDateTime(params.date, '00:00');
    const dayEnd = addDays(dayStart, 1);

    const normalizedQ = params.q ? params.q.replace(/#/g, '').trim() : '';
    const hasQ = normalizedQ.length > 0;
    const qLike = hasQ ? `%${normalizedQ}%` : null;
    const qFilterSql = hasQ
      ? `AND (
          b.BookingCode LIKE @qLike
          OR cu.FullName LIKE @qLike
          OR b.GuestName LIKE @qLike
          OR cu.Phone LIKE @qLike
          OR b.GuestPhone LIKE @qLike
        )`
      : '';

    const countsReq = exec
      .request()
      .input('branchId', sql.Int, params.branchId)
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(dayStart))
      .input('dayEnd', sql.DateTime2(0), toSqlDateTime(dayEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(params.now))
      .input('grace', sql.Int, params.noShowGraceMinutes);
    if (hasQ) {
      countsReq.input('qLike', sql.NVarChar(200), qLike);
    }

    const countsRes = await countsReq.query<{
      ALL_CNT: number | null;
      WAITING_CNT: number | null;
      IN_USE_CNT: number | null;
      OVERDUE_CNT: number | null;
      PENDING_PAYMENT_CNT: number | null;
      COMPLETED_CNT: number | null;
      CANCELED_CNT: number | null;
      EXPIRED_CNT: number | null;
    }>(`
      SELECT
        COUNT(*) AS ALL_CNT,
        ISNULL(SUM(CASE
          WHEN b.Status = 'CONFIRMED'
           AND (b.CheckedInAt IS NOT NULL OR @now < DATEADD(MINUTE, @grace, b.StartAt))
          THEN 1 ELSE 0
        END), 0) AS WAITING_CNT,
        ISNULL(SUM(CASE WHEN b.Status = 'IN_USE' THEN 1 ELSE 0 END), 0) AS IN_USE_CNT,
        ISNULL(SUM(CASE
          WHEN b.Status = 'CONFIRMED'
           AND b.CheckedInAt IS NULL
           AND @now >= DATEADD(MINUTE, @grace, b.StartAt)
          THEN 1 ELSE 0
        END), 0) AS OVERDUE_CNT,
        ISNULL(SUM(CASE WHEN b.Status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END), 0) AS PENDING_PAYMENT_CNT,
        ISNULL(SUM(CASE WHEN b.Status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS COMPLETED_CNT,
        ISNULL(SUM(CASE WHEN b.Status = 'CANCELED' THEN 1 ELSE 0 END), 0) AS CANCELED_CNT,
        ISNULL(SUM(CASE WHEN b.Status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS EXPIRED_CNT
      FROM dbo.Bookings b
      LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
      WHERE b.BranchId = @branchId
        AND b.StartAt >= @dayStart
        AND b.StartAt < @dayEnd
        ${qFilterSql}
    `);

    const cRow = countsRes.recordset[0];
    const tabCounts: Record<PosBookingTab, number> = {
      ALL: Number(cRow?.ALL_CNT ?? 0),
      WAITING: Number(cRow?.WAITING_CNT ?? 0),
      IN_USE: Number(cRow?.IN_USE_CNT ?? 0),
      OVERDUE: Number(cRow?.OVERDUE_CNT ?? 0),
      PENDING_PAYMENT: Number(cRow?.PENDING_PAYMENT_CNT ?? 0),
      COMPLETED: Number(cRow?.COMPLETED_CNT ?? 0),
      CANCELED: Number(cRow?.CANCELED_CNT ?? 0),
      EXPIRED: Number(cRow?.EXPIRED_CNT ?? 0),
    };

    const totalItems = tabCounts[params.tab];
    if (totalItems === 0) {
      return { rows: [], totalItems: 0, tabCounts };
    }

    let tabFilterSql = '';
    if (params.tab === 'WAITING') {
      tabFilterSql = `AND b.Status = 'CONFIRMED' AND (b.CheckedInAt IS NOT NULL OR @now < DATEADD(MINUTE, @grace, b.StartAt))`;
    } else if (params.tab === 'OVERDUE') {
      tabFilterSql = `AND b.Status = 'CONFIRMED' AND b.CheckedInAt IS NULL AND @now >= DATEADD(MINUTE, @grace, b.StartAt)`;
    } else if (params.tab !== 'ALL') {
      tabFilterSql = 'AND b.Status = @tabStatus';
    }

    const offset = (params.page - 1) * params.pageSize;
    const rowsReq = exec
      .request()
      .input('branchId', sql.Int, params.branchId)
      .input('dayStart', sql.DateTime2(0), toSqlDateTime(dayStart))
      .input('dayEnd', sql.DateTime2(0), toSqlDateTime(dayEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(params.now))
      .input('grace', sql.Int, params.noShowGraceMinutes)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, params.pageSize);
    if (hasQ) {
      rowsReq.input('qLike', sql.NVarChar(200), qLike);
    }
    if (params.tab !== 'ALL' && params.tab !== 'WAITING' && params.tab !== 'OVERDUE') {
      rowsReq.input('tabStatus', sql.VarChar(20), params.tab);
    }

    const rowsRes = await rowsReq.query<BookingRow>(`
      SELECT ${BOOKING_SELECT}
      ${BOOKING_FROM}
      WHERE b.BranchId = @branchId
        AND b.StartAt >= @dayStart
        AND b.StartAt < @dayEnd
        ${qFilterSql}
        ${tabFilterSql}
      ORDER BY
        CASE
          WHEN b.Status = 'CONFIRMED' AND b.CheckedInAt IS NULL AND @now >= DATEADD(MINUTE, @grace, b.StartAt) THEN 1
          WHEN b.Status = 'CONFIRMED' THEN 2
          WHEN b.Status = 'PENDING_PAYMENT' THEN 3
          WHEN b.Status = 'IN_USE' THEN 4
          WHEN b.Status = 'COMPLETED' THEN 5
          WHEN b.Status = 'CANCELED' THEN 6
          ELSE 7
        END ASC,
        b.StartAt ASC,
        b.BookingId ASC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return {
      rows: rowsRes.recordset,
      totalItems,
      tabCounts,
    };
  }

  async getScheduleData(
    exec: DbExecutor,
    branchId: number,
    date: string,
    sportId: number | undefined,
    now: Date,
  ): Promise<PosScheduleData> {
    const dayOfWeek = vnDayOfWeek(date);
    const dayStart = parseVnDateTime(date, '00:00');
    const dayEnd = addDays(dayStart, 1);

    const [branchRes, openingRes, holidayRes, sportRes, courtsRes] = await Promise.all([
      exec
        .request()
        .input('branchId', sql.Int, branchId)
        .query<{ BranchId: number; Name: string; Status: BranchStatus }>(`
          SELECT BranchId, Name, Status
          FROM dbo.Branches
          WHERE BranchId = @branchId AND Status = 'ACTIVE'
        `),
      exec
        .request()
        .input('branchId', sql.Int, branchId)
        .input('dayOfWeek', sql.TinyInt, dayOfWeek)
        .query<{ OpenTime: Date | string | null; CloseTime: Date | string | null; IsClosed: boolean | number }>(`
          SELECT OpenTime, CloseTime, IsClosed
          FROM dbo.BranchOpeningHours
          WHERE BranchId = @branchId AND DayOfWeek = @dayOfWeek
        `),
      exec
        .request()
        .input('branchId', sql.Int, branchId)
        .input('date', sql.Date, toSqlDate(date))
        .query<{ HolidayId: number; StartDate: Date | string; EndDate: Date | string; Reason: string | null }>(`
          SELECT TOP 1 HolidayId, StartDate, EndDate, Reason
          FROM dbo.BranchHolidays
          WHERE BranchId = @branchId AND StartDate <= @date AND EndDate >= @date
          ORDER BY HolidayId ASC
        `),
      sportId !== undefined
        ? exec
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
            `)
        : Promise.resolve(null),
      (() => {
        const req = exec.request().input('branchId', sql.Int, branchId);
        const sportFilter = sportId !== undefined ? 'AND c.SportId = @sportId' : '';
        if (sportId !== undefined) {
          req.input('sportId', sql.Int, sportId);
        }
        return req.query<{
          CourtId: number;
          Code: string;
          Name: string;
          SportId: number;
          SportCode: string;
          SportName: string;
          GridBlockMinutes: number;
          DisplayBlockMinutes: number;
        }>(`
          SELECT
            c.CourtId,
            c.Code,
            c.Name,
            c.SportId,
            s.Code AS SportCode,
            s.Name AS SportName,
            s.GridBlockMinutes,
            s.DisplayBlockMinutes
          FROM dbo.Courts c
          INNER JOIN dbo.Sports s ON s.SportId = c.SportId
          WHERE c.BranchId = @branchId
            AND c.Status = 'ACTIVE'
            ${sportFilter}
          ORDER BY s.SortOrder ASC, c.CourtId ASC
        `);
      })(),
    ]);

    const branchRow = branchRes.recordset[0] ?? null;
    const ohRow = openingRes.recordset[0] ?? null;
    const holRow = holidayRes.recordset[0] ?? null;
    const sportRow = sportRes?.recordset[0] ?? null;

    const courts: PosScheduleCourtRecord[] = courtsRes.recordset.map((c) => ({
      courtId: Number(c.CourtId),
      code: c.Code,
      name: c.Name,
      sportId: Number(c.SportId),
      sportCode: c.SportCode,
      sportName: c.SportName,
      gridBlockMinutes: Number(c.GridBlockMinutes),
      displayBlockMinutes: Number(c.DisplayBlockMinutes),
    }));

    let priceRules: PosSchedulePriceRule[] = [];
    let blocks: PosScheduleBlockRecord[] = [];
    let bookedSlots: PosScheduleBookedSlotRecord[] = [];

    if (branchRow && courts.length > 0) {
      const courtIds = courts.map((c) => c.courtId);
      const rulesReq = exec
        .request()
        .input('now', sql.DateTime2(0), toSqlDateTime(new Date(Math.floor(now.getTime() / 1_000) * 1_000)));
      const rulesIn = buildIntInClause('rc', courtIds, rulesReq);

      const blocksReq = exec
        .request()
        .input('dayStart', sql.DateTime2(0), toSqlDateTime(dayStart))
        .input('dayEnd', sql.DateTime2(0), toSqlDateTime(dayEnd));
      const blocksIn = buildIntInClause('bc', courtIds, blocksReq);

      const slotsReq = exec
        .request()
        .input('dayStart', sql.DateTime2(0), toSqlDateTime(dayStart))
        .input('dayEnd', sql.DateTime2(0), toSqlDateTime(dayEnd));
      const slotsIn = buildIntInClause('sc', courtIds, slotsReq);

      const [rulesRes, blocksRes, slotsRes] = await Promise.all([
        rulesReq.query<{
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
            PriceRuleId, CourtId, Label, DayOfWeekMask, StartTime, EndTime,
            PricePerHour, EffectiveFrom, EffectiveTo
          FROM dbo.CourtPriceRules
          WHERE CourtId IN (${rulesIn})
            AND EffectiveFrom <= @now
            AND (EffectiveTo IS NULL OR EffectiveTo > @now)
          ORDER BY CourtId ASC, StartTime ASC, PriceRuleId ASC
        `),
        blocksReq.query<{
          BlockId: number | string;
          CourtId: number;
          BlockType: BlockType;
          StartAt: Date | string;
          EndAt: Date | string | null;
          Reason: string;
        }>(`
          SELECT BlockId, CourtId, BlockType, StartAt, EndAt, Reason
          FROM dbo.CourtBlocks
          WHERE CourtId IN (${blocksIn})
            AND ReleasedAt IS NULL
            AND StartAt < @dayEnd
            AND (EndAt IS NULL OR EndAt > @dayStart)
          ORDER BY BlockId ASC
        `),
        slotsReq.query<{
          CourtId: number;
          SlotStart: Date | string;
          BookingId: number | string;
          BookingCode: string;
          Status: BookingStatus;
          PaymentStatus: PaymentStatus;
          PaidAmount: number | string;
          TotalAmount: number | string;
          StartAt: Date | string;
          CheckedInAt: Date | string | null;
          CustomerUserId: number | string | null;
          CustomerFullName: string | null;
          CustomerPhone: string | null;
          GuestName: string | null;
          GuestPhone: string | null;
        }>(`
          SELECT
            bs.CourtId,
            bs.SlotStart,
            b.BookingId,
            b.BookingCode,
            b.Status,
            b.PaymentStatus,
            b.PaidAmount,
            b.TotalAmount,
            b.StartAt,
            b.CheckedInAt,
            b.CustomerUserId,
            cu.FullName AS CustomerFullName,
            cu.Phone AS CustomerPhone,
            b.GuestName,
            b.GuestPhone
          FROM dbo.BookingSlots bs
          INNER JOIN dbo.Bookings b ON b.BookingId = bs.BookingId
          LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
          WHERE bs.CourtId IN (${slotsIn})
            AND bs.IsActive = 1
            AND bs.SlotStart >= @dayStart
            AND bs.SlotStart < @dayEnd
            AND b.Status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_USE')
          ORDER BY bs.SlotStart ASC
        `),
      ]);

      priceRules = rulesRes.recordset.map((r) => ({
        priceRuleId: Number(r.PriceRuleId),
        courtId: Number(r.CourtId),
        label: r.Label,
        dayOfWeekMask: Number(r.DayOfWeekMask),
        startTime: fromSqlTime(r.StartTime),
        endTime: fromSqlTime(r.EndTime),
        pricePerHour: Number(r.PricePerHour),
        effectiveFrom: fromSqlDateTime(r.EffectiveFrom),
        effectiveTo: r.EffectiveTo ? fromSqlDateTime(r.EffectiveTo) : null,
      }));

      blocks = blocksRes.recordset.map((b) => ({
        blockId: Number(b.BlockId),
        courtId: Number(b.CourtId),
        blockType: b.BlockType,
        startAt: fromSqlDateTime(b.StartAt),
        endAt: b.EndAt ? fromSqlDateTime(b.EndAt) : null,
        reason: b.Reason,
      }));

      bookedSlots = slotsRes.recordset.map((s) => {
        const isGuest = s.CustomerUserId === null;
        return {
          courtId: Number(s.CourtId),
          slotStart: fromSqlDateTime(s.SlotStart),
          bookingId: Number(s.BookingId),
          bookingCode: s.BookingCode,
          status: s.Status,
          paymentStatus: s.PaymentStatus,
          paidAmount: Number(s.PaidAmount),
          totalAmount: Number(s.TotalAmount),
          startAt: fromSqlDateTime(s.StartAt),
          checkedInAt: s.CheckedInAt ? fromSqlDateTime(s.CheckedInAt) : null,
          isGuest,
          customerName: isGuest ? (s.GuestName ?? '') : (s.CustomerFullName ?? ''),
          customerPhone: isGuest ? (s.GuestPhone ?? '') : (s.CustomerPhone ?? ''),
        };
      });
    }

    const isClosed = ohRow ? Boolean(ohRow.IsClosed) : true;
    return {
      branch: branchRow
        ? {
            branchId: Number(branchRow.BranchId),
            name: branchRow.Name,
            status: branchRow.Status,
          }
        : null,
      openingHour: ohRow
        ? {
            openTime: isClosed || ohRow.OpenTime === null ? null : fromSqlTime(ohRow.OpenTime),
            closeTime: isClosed || ohRow.CloseTime === null ? null : fromSqlTime(ohRow.CloseTime),
            isClosed,
          }
        : null,
      holiday: holRow
        ? {
            holidayId: Number(holRow.HolidayId),
            startDate: fromSqlDate(holRow.StartDate),
            endDate: fromSqlDate(holRow.EndDate),
            reason: holRow.Reason,
          }
        : null,
      sport: sportRow
        ? {
            sportId: Number(sportRow.SportId),
            code: sportRow.Code,
            name: sportRow.Name,
            gridBlockMinutes: Number(sportRow.GridBlockMinutes),
            displayBlockMinutes: Number(sportRow.DisplayBlockMinutes),
          }
        : null,
      courts,
      priceRules,
      blocks,
      bookedSlots,
    };
  }

  async listActivePromotionsForPos(
    exec: DbExecutor,
    branchId: number,
    date: string,
    customerId: number | null = null,
  ): Promise<PosPromotionRecord[]> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .input('date', sql.Date, toSqlDate(date))
      .input('customerId', sql.BigInt, customerId)
      .query<{
        PromotionId: number;
        Code: string;
        Name: string;
        Status: PromotionStatus;
        DiscountType: DiscountType;
        DiscountValue: number | string;
        MaxDiscountAmount: number | string | null;
        StartDate: Date | string;
        EndDate: Date | string;
        TimeFrom: Date | string | null;
        TimeTo: Date | string | null;
        AllBranches: boolean | number;
        AllSports: boolean | number;
        AudienceType: AudienceType;
        MaxUses: number;
        UsedCount: number;
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
          CASE WHEN @customerId IS NOT NULL AND EXISTS (
            SELECT 1 FROM dbo.PromotionCustomers pc
            WHERE pc.PromotionId = p.PromotionId AND pc.CustomerId = @customerId
          ) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsCustomerEligible
        FROM dbo.Promotions p
        WHERE p.Status = 'ACTIVE'
          AND p.StartDate <= @date
          AND p.EndDate >= @date
          AND (
            p.AllBranches = 1
            OR EXISTS (
              SELECT 1 FROM dbo.PromotionBranches pb
              WHERE pb.PromotionId = p.PromotionId AND pb.BranchId = @branchId
            )
          )
        ORDER BY p.EndDate ASC, p.PromotionId ASC
      `);

    const promos = res.recordset;
    if (promos.length === 0) return [];

    const promoIds = promos.map((p) => Number(p.PromotionId));
    const sportsReq = exec.request();
    const inClause = buildIntInClause('pid', promoIds, sportsReq);
    const sportsRes = await sportsReq.query<{ PromotionId: number; SportId: number }>(`
      SELECT PromotionId, SportId
      FROM dbo.PromotionSports
      WHERE PromotionId IN (${inClause})
    `);

    const sportIdsMap = new Map<number, number[]>();
    for (const row of sportsRes.recordset) {
      const pid = Number(row.PromotionId);
      const list = sportIdsMap.get(pid);
      if (list) {
        list.push(Number(row.SportId));
      } else {
        sportIdsMap.set(pid, [Number(row.SportId)]);
      }
    }

    return promos.map((p) => ({
      promotionId: Number(p.PromotionId),
      code: p.Code,
      name: p.Name,
      status: p.Status,
      discountType: p.DiscountType,
      discountValue: Number(p.DiscountValue),
      maxDiscountAmount: p.MaxDiscountAmount !== null ? Number(p.MaxDiscountAmount) : null,
      startDate: fromSqlDate(p.StartDate),
      endDate: fromSqlDate(p.EndDate),
      timeFrom: p.TimeFrom !== null ? fromSqlTime(p.TimeFrom) : null,
      timeTo: p.TimeTo !== null ? fromSqlTime(p.TimeTo) : null,
      allBranches: Boolean(p.AllBranches),
      allSports: Boolean(p.AllSports),
      audienceType: p.AudienceType,
      maxUses: Number(p.MaxUses),
      usedCount: Number(p.UsedCount),
      isCustomerEligible: Boolean(p.IsCustomerEligible),
      sportIds: sportIdsMap.get(Number(p.PromotionId)) ?? [],
    }));
  }
}
