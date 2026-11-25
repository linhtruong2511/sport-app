import { Inject, Injectable } from '@nestjs/common';
import type { BlockType, PaymentStatus, PromoReasonCode } from '@sporthub/shared/enums';
import type { BookingSummaryDto, ReceiptDto } from '@sporthub/shared/types';
import { AffectedBookingsService } from '../affected-bookings/affected-bookings.service.js';
import { computeIsOverdue, toBookingSummaryDto } from '../bookings/bookings.mapper.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { SettingsService } from '../core/settings.service.js';
import {
  dayOfWeekBit,
  formatDateVn,
  minutesToTime,
  parseTimeToMinutes,
  parseVnDateTime,
  vnDayOfWeek,
} from '../core/time.js';
import {
  calculateRentalPrice,
  evaluatePromotion,
  type PriceRuleInput,
} from '../pricing/pricing.engine.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import {
  type PosCustomerRecord,
  PosRepository,
  type PosScheduleBlockRecord,
  type PosScheduleBookedSlotRecord,
  type PosSchedulePriceRule,
} from './pos.repository.js';
import type {
  PosBookingsListQuery,
  PosBookingTab,
  PosPromotionsQuery,
  PosScheduleQuery,
} from './pos.schemas.js';

export interface PosScheduleSlotHeader {
  start: string;
  end: string;
  priceLabel: string | null;
  isPeak: boolean;
}

export type PosScheduleCell =
  | {
      start: string;
      end: string;
      state: 'FREE';
      price?: number;
    }
  | {
      start: string;
      end: string;
      state: 'LOCKED';
      blockId: number;
      blockType: BlockType;
      reason: string;
    }
  | {
      start: string;
      end: string;
      state: 'PENDING_PAYMENT' | 'BOOKED' | 'IN_USE';
      booking: {
        bookingCode: string;
        customerName: string;
        customerPhone: string;
        isGuest: boolean;
        paymentStatus: PaymentStatus;
        paidAmount: number;
        totalAmount: number;
        isOverdue: boolean;
      };
    };

export interface PosScheduleResult {
  date: string;
  branch: {
    branchId: number;
    name: string;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  };
  holiday: {
    holidayId: number;
    startDate: string;
    endDate: string;
    reason: string | null;
  } | null;
  slotMinutes: number;
  slots: PosScheduleSlotHeader[];
  courts: Array<{
    courtId: number;
    code: string;
    name: string;
    sportId: number;
    sportCode: string;
    sportName: string;
    minPricePerHour: number;
    maxPricePerHour: number;
    cells: PosScheduleCell[];
  }>;
}

export interface PosPromotionItemDto {
  code: string;
  name: string;
  applicable: boolean;
  discountAmount: number;
  reasonCode: PromoReasonCode | null;
  message: string | null;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function buildTimeSlots(
  openTime: string | null,
  closeTime: string | null,
  isClosed: boolean,
  hasHoliday: boolean,
  slotMinutes: number,
): Array<{ start: string; end: string }> {
  if (isClosed || hasHoliday || !openTime || !closeTime || slotMinutes <= 0) {
    return [];
  }
  const openMin = parseTimeToMinutes(openTime);
  const closeMin = parseTimeToMinutes(closeTime);
  const slots: Array<{ start: string; end: string }> = [];
  for (let cur = openMin; cur + slotMinutes <= closeMin; cur += slotMinutes) {
    slots.push({
      start: minutesToTime(cur),
      end: minutesToTime(cur + slotMinutes),
    });
  }
  return slots;
}

function getSlotPriceLabel(
  slotStart: string,
  slotEnd: string,
  dowBit: number,
  rules: PosSchedulePriceRule[],
): string | null {
  const sMin = parseTimeToMinutes(slotStart);
  const eMin = parseTimeToMinutes(slotEnd);
  const labels: string[] = [];

  for (const r of rules) {
    if ((r.dayOfWeekMask & dowBit) === 0) continue;
    const rStart = parseTimeToMinutes(r.startTime);
    const rEnd = parseTimeToMinutes(r.endTime);
    if (rStart < eMin && rEnd > sMin && !labels.includes(r.label)) {
      labels.push(r.label);
    }
  }

  return labels.length > 0 ? labels.join(' / ') : null;
}

function computeCellPrice(
  date: string,
  startTime: string,
  endTime: string,
  now: Date,
  rules: PriceRuleInput[],
): number | null {
  try {
    const { baseAmount } = calculateRentalPrice({
      date,
      startTime,
      endTime,
      now,
      rules,
    });
    return baseAmount;
  } catch {
    return null;
  }
}

@Injectable()
export class PosScheduleService {
  constructor(
    private readonly repo: PosRepository,
    private readonly pricingRepo: PricingRepository,
    private readonly affectedBookingsService: AffectedBookingsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-25: POS live schedule
  async getSchedule(branchId: number, query: PosScheduleQuery): Promise<PosScheduleResult> {
    const now = this.clock.now();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const exec = await this.txService.executor();
    const data = await this.repo.getScheduleData(exec, branchId, query.date, query.sportId, now);

    if (!data.branch) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
    }
    if (query.sportId !== undefined && !data.sport) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy bộ môn.');
    }

    const isClosed = data.openingHour ? data.openingHour.isClosed : true;
    const openTime = isClosed ? null : (data.openingHour?.openTime ?? null);
    const closeTime = isClosed ? null : (data.openingHour?.closeTime ?? null);

    let slotMinutes = 60;
    if (data.sport) {
      slotMinutes = data.sport.displayBlockMinutes;
    } else if (data.courts.length > 0) {
      slotMinutes = data.courts
        .map((c) => c.displayBlockMinutes)
        .reduce((acc, val) => gcd(acc, val));
    }

    const rawSlots = buildTimeSlots(
      openTime,
      closeTime,
      isClosed,
      data.holiday !== null,
      slotMinutes,
    );

    const dowBit = dayOfWeekBit(vnDayOfWeek(query.date));
    const headerRules =
      data.courts.length > 0
        ? data.priceRules.filter((r) => r.courtId === data.courts[0].courtId)
        : [];
    const fallbackHeaderRules = headerRules.length > 0 ? headerRules : data.priceRules;

    const slots: PosScheduleSlotHeader[] = rawSlots.map((s) => {
      const priceLabel = getSlotPriceLabel(s.start, s.end, dowBit, fallbackHeaderRules);
      const isPeak = priceLabel !== null && /cao\s*điểm/i.test(priceLabel);
      return {
        start: s.start,
        end: s.end,
        priceLabel,
        isPeak,
      };
    });

    const rulesByCourt = this.groupByCourt(data.priceRules);
    const blocksByCourt = this.groupByCourt(data.blocks);
    const slotsByCourt = this.groupByCourt(data.bookedSlots);

    const courts = data.courts.map((court) => {
      const courtRules = rulesByCourt.get(court.courtId) ?? [];
      const courtBlocks = blocksByCourt.get(court.courtId) ?? [];
      const courtBookings = slotsByCourt.get(court.courtId) ?? [];

      const matchingDowRules = courtRules.filter((r) => (r.dayOfWeekMask & dowBit) !== 0);
      const priceSource = matchingDowRules.length > 0 ? matchingDowRules : courtRules;
      const prices = priceSource.map((r) => r.pricePerHour);
      const minPricePerHour = prices.length > 0 ? Math.min(...prices) : 0;
      const maxPricePerHour = prices.length > 0 ? Math.max(...prices) : 0;

      // R-16: mỗi sân dựng ô theo DisplayBlockMinutes của chính môn đó (Pickleball 120, bóng đá 90…).
      // `slots` ở header chỉ là lưới thời gian mịn nhất khi xem nhiều môn, không phải độ rộng ô của từng sân.
      const courtSlots = buildTimeSlots(
        openTime,
        closeTime,
        isClosed,
        data.holiday !== null,
        court.displayBlockMinutes,
      );
      const cells: PosScheduleCell[] = courtSlots.map((s) =>
        this.resolvePosCell({
          date: query.date,
          start: s.start,
          end: s.end,
          now,
          noShowGraceMinutes,
          courtBlocks,
          courtBookings,
          courtRules,
        }),
      );

      return {
        courtId: court.courtId,
        code: court.code,
        name: court.name,
        sportId: court.sportId,
        sportCode: court.sportCode,
        sportName: court.sportName,
        minPricePerHour,
        maxPricePerHour,
        cells,
      };
    });

    return {
      date: query.date,
      branch: {
        branchId: data.branch.branchId,
        name: data.branch.name,
        openTime,
        closeTime,
        isClosed,
      },
      holiday: data.holiday,
      slotMinutes,
      slots,
      courts,
    };
  }

  // API-26: Lookup customer by phone
  async lookupCustomerByPhone(phone: string): Promise<{
    found: boolean;
    customer: PosCustomerRecord | null;
  }> {
    const exec = await this.txService.executor();
    const customer = await this.repo.findCustomerByPhone(exec, phone);
    if (!customer) {
      return { found: false, customer: null };
    }
    return { found: true, customer };
  }

  // API-27: Applicable promotions at counter
  async listPromotions(
    branchId: number,
    query: PosPromotionsQuery,
  ): Promise<{ defaultCode: string | null; items: PosPromotionItemDto[] }> {
    const now = this.clock.now();
    const targetDate = query.date ?? formatDateVn(now);
    const exec = await this.txService.executor();

    const customer = query.customerPhone
      ? await this.repo.findCustomerByPhone(exec, query.customerPhone)
      : null;
    const customerId = customer?.userId ?? null;
    const isGuest = customerId === null;

    const promos = await this.repo.listActivePromotionsForPos(exec, branchId, targetDate, customerId);

    const hasSlotContext =
      query.courtId !== undefined &&
      query.date !== undefined &&
      query.startTime !== undefined &&
      query.endTime !== undefined &&
      query.startTime < query.endTime;

    let courtSportId: number | null = null;
    let baseAmount: number | null = null;

    if (hasSlotContext) {
      const court = await this.pricingRepo.findCourtContext(query.courtId!, exec);
      if (court && court.branchId === branchId) {
        courtSportId = court.sportId;
        try {
          const rules = await this.pricingRepo.findActivePriceRules(court.courtId, now, exec);
          const rental = calculateRentalPrice({
            date: query.date!,
            startTime: query.startTime!,
            endTime: query.endTime!,
            now,
            rules,
          });
          baseAmount = rental.baseAmount;
        } catch {
          baseAmount = null;
        }
      }
    }

    const items: PosPromotionItemDto[] = promos.map((p) => {
      if (hasSlotContext && courtSportId !== null && baseAmount !== null) {
        const isSportEligible = p.allSports || p.sportIds.includes(courtSportId);
        const evalResult = evaluatePromotion({
          code: p.code,
          promo: {
            promotionId: p.promotionId,
            code: p.code,
            name: p.name,
            status: p.status,
            discountType: p.discountType,
            discountValue: p.discountValue,
            maxDiscountAmount: p.maxDiscountAmount,
            startDate: p.startDate,
            endDate: p.endDate,
            timeFrom: p.timeFrom,
            timeTo: p.timeTo,
            allBranches: p.allBranches,
            allSports: p.allSports,
            audienceType: p.audienceType,
            maxUses: p.maxUses,
            usedCount: p.usedCount,
          },
          date: query.date!,
          startTime: query.startTime!,
          endTime: query.endTime!,
          baseAmount,
          isGuest,
          isBranchEligible: true,
          isSportEligible,
          isCustomerEligible: p.isCustomerEligible,
        });

        return {
          code: p.code,
          name: p.name,
          applicable: evalResult.applied,
          discountAmount: evalResult.discountAmount,
          reasonCode: evalResult.reasonCode,
          message: evalResult.applied ? null : evalResult.message,
        };
      }

      if (p.audienceType === 'SPECIFIC' && (isGuest || !p.isCustomerEligible)) {
        return {
          code: p.code,
          name: p.name,
          applicable: false,
          discountAmount: 0,
          reasonCode: 'PROMO_WRONG_AUDIENCE',
          message: 'Mã chỉ dành cho khách hàng được chỉ định.',
        };
      }

      if (p.usedCount >= p.maxUses) {
        return {
          code: p.code,
          name: p.name,
          applicable: false,
          discountAmount: 0,
          reasonCode: 'PROMO_EXHAUSTED',
          message: 'Mã khuyến mãi đã hết lượt sử dụng.',
        };
      }

      return {
        code: p.code,
        name: p.name,
        applicable: true,
        discountAmount: 0,
        reasonCode: null,
        message: null,
      };
    });

    return { defaultCode: null, items };
  }

  // API-31: Latest counter receipt for branch
  async getLatestReceipt(branchId: number): Promise<ReceiptDto | null> {
    const exec = await this.txService.executor();
    return this.repo.findLatestCounterReceipt(exec, branchId);
  }

  // API-32: List branch bookings by date
  async listBranchBookings(
    branchId: number,
    query: PosBookingsListQuery,
    caller: AuthenticatedUser,
  ): Promise<{
    items: BookingSummaryDto[];
    totalItems: number;
    tabCounts: Record<PosBookingTab | 'AFFECTED', number>;
  }> {
    const now = this.clock.now();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const exec = await this.txService.executor();

    const [result, affectedRows] = await Promise.all([
      this.repo.listBranchBookingsByDate(exec, {
        branchId,
        date: query.date,
        tab: query.tab,
        q: query.q,
        page: query.page,
        pageSize: query.pageSize,
        now,
        noShowGraceMinutes,
      }),
      this.affectedBookingsService.computeAffectedRows(exec, {
        branchId,
        callerRole: caller.role,
        callerUserId: caller.userId,
      }),
    ]);

    const affectedCodes = new Set(affectedRows.map((a) => a.bookingCode));

    const items = result.rows.map((row) =>
      toBookingSummaryDto(row, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
        isAffected: affectedCodes.has(row.BookingCode),
      }),
    );

    return {
      items,
      totalItems: result.totalItems,
      tabCounts: {
        ...result.tabCounts,
        AFFECTED: affectedRows.length,
      },
    };
  }

  private resolvePosCell(params: {
    date: string;
    start: string;
    end: string;
    now: Date;
    noShowGraceMinutes: number;
    courtBlocks: PosScheduleBlockRecord[];
    courtBookings: PosScheduleBookedSlotRecord[];
    courtRules: PosSchedulePriceRule[];
  }): PosScheduleCell {
    const {
      date,
      start,
      end,
      now,
      noShowGraceMinutes,
      courtBlocks,
      courtBookings,
      courtRules,
    } = params;

    const slotStartAt = parseVnDateTime(date, start);
    const slotEndAt = parseVnDateTime(date, end);

    const overlappingBlock = courtBlocks.find(
      (b) => b.startAt < slotEndAt && (b.endAt === null || b.endAt > slotStartAt),
    );
    if (overlappingBlock) {
      return {
        start,
        end,
        state: 'LOCKED',
        blockId: overlappingBlock.blockId,
        blockType: overlappingBlock.blockType,
        reason: overlappingBlock.reason,
      };
    }

    const overlappingBooking = courtBookings.find(
      (bs) => bs.slotStart >= slotStartAt && bs.slotStart < slotEndAt,
    );
    if (overlappingBooking) {
      const state =
        overlappingBooking.status === 'IN_USE'
          ? 'IN_USE'
          : overlappingBooking.status === 'PENDING_PAYMENT'
            ? 'PENDING_PAYMENT'
            : 'BOOKED';

      return {
        start,
        end,
        state,
        booking: {
          bookingCode: overlappingBooking.bookingCode,
          customerName: overlappingBooking.customerName,
          customerPhone: overlappingBooking.customerPhone,
          isGuest: overlappingBooking.isGuest,
          paymentStatus: overlappingBooking.paymentStatus,
          paidAmount: overlappingBooking.paidAmount,
          totalAmount: overlappingBooking.totalAmount,
          isOverdue: computeIsOverdue(
            overlappingBooking.status,
            overlappingBooking.checkedInAt,
            overlappingBooking.startAt,
            now,
            noShowGraceMinutes,
          ),
        },
      };
    }

    const price = computeCellPrice(date, start, end, now, courtRules);
    return price !== null ? { start, end, state: 'FREE', price } : { start, end, state: 'FREE' };
  }

  private groupByCourt<T extends { courtId: number }>(items: T[]): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const item of items) {
      const list = map.get(item.courtId);
      if (list) {
        list.push(item);
      } else {
        map.set(item.courtId, [item]);
      }
    }
    return map;
  }
}
