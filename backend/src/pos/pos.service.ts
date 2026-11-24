import { Inject, Injectable } from '@nestjs/common';
import type {
  BlockType,
  PaymentStatus,
  PromoReasonCode,
} from '@sporthub/shared/enums';
import type { BookingSummaryDto, ReceiptDto } from '@sporthub/shared/types';
import { AffectedBookingsService } from '../affected-bookings/affected-bookings.service.js';
import { BookingStateService } from '../bookings/booking-state.service.js';
import {
  computeIsOverdue,
  decodeRowVer,
  encodeRowVer,
  toBookingSummaryDto,
} from '../bookings/bookings.mapper.js';
import { BookingsRepository } from '../bookings/bookings.repository.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { nextCode } from '../core/codes.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { SettingsService } from '../core/settings.service.js';
import {
  addMinutes,
  dayOfWeekBit,
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
  minutesToTime,
  parseTimeToMinutes,
  parseVnDateTime,
  toDateKey,
  toIsoVn,
  vnDayOfWeek,
} from '../core/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  assertPaymentOptionAllowed,
  calculateQuoteAmounts,
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
  CreatePosBookingDto,
  PosAbortDto,
  PosBookingsListQuery,
  PosBookingTab,
  PosCashPaymentDto,
  PosCheckInDto,
  PosCompleteDto,
  PosPromotionsQuery,
  PosScheduleQuery,
  PosSettleDto,
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

function formatVnd(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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
export class PosService {
  constructor(
    private readonly repo: PosRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookingState: BookingStateService,
    private readonly pricingRepo: PricingRepository,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
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

      const cells: PosScheduleCell[] = rawSlots.map((s) =>
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

  // API-28: Create booking at counter (with optional immediate CASH payment)
  async createPosBooking(
    dto: CreatePosBookingDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto; receipt: ReceiptDto | null }> {
    const effectiveBranchId =
      caller.role === 'STAFF' ? (caller.branchId ?? -1) : dto.branchId;

    const [holdMinutes, noShowGraceMinutes] = await Promise.all([
      this.settingsService.getInt('BOOKING_HOLD_MINUTES'),
      this.settingsService.getInt('NO_SHOW_GRACE_MINUTES'),
    ]);

    const now = this.clock.now();
    const startAt = parseVnDateTime(dto.date, dto.startTime);
    const endAt = parseVnDateTime(dto.date, dto.endTime);
    const startMin = parseTimeToMinutes(dto.startTime);
    const endMin = parseTimeToMinutes(dto.endTime);

    return this.txService.withTransaction(async (tx) => {
      // 1. Court exists & belongs to branch
      const court = await this.pricingRepo.findCourtContext(dto.courtId, tx);
      if (!court) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
      }

      if (court.branchId !== effectiveBranchId) {
        if (caller.role === 'STAFF') {
          throw new AppError('BRANCH_FORBIDDEN', 'Sân không thuộc chi nhánh của nhân viên.');
        }
        throw new AppError('VALIDATION_ERROR', {
          details: [{ field: 'courtId', message: 'Sân không thuộc chi nhánh đã chọn.' }],
        });
      }

      // Resolve customer (MEMBER vs GUEST)
      let customerUserId: number | null = null;
      let guestName: string | null = null;
      let guestPhone: string | null = null;

      if (dto.customer.type === 'MEMBER') {
        let member: PosCustomerRecord | null = null;
        if (dto.customer.userId !== null && dto.customer.userId !== undefined) {
          member = await this.repo.findMemberById(tx, dto.customer.userId);
        } else if (dto.customer.phone && /^0\d{9}$/.test(dto.customer.phone)) {
          member = await this.repo.findCustomerByPhone(tx, dto.customer.phone);
        }
        if (!member) {
          throw new AppError('MEMBER_NOT_FOUND');
        }
        customerUserId = member.userId;
      } else {
        guestName = dto.customer.fullName!.trim();
        guestPhone = dto.customer.phone!.trim();
      }

      const hasBlock = await this.pricingRepo.hasOverlappingCourtBlock(
        court.courtId,
        startAt,
        endAt,
        tx,
      );
      if (court.courtStatus !== 'ACTIVE' || hasBlock) {
        throw new AppError('COURT_UNAVAILABLE');
      }

      // 2. Branch ACTIVE, no holiday, opening hours
      const dayOfWeek = vnDayOfWeek(dto.date);
      const hasHoliday = await this.pricingRepo.hasBranchHoliday(court.branchId, dto.date, tx);
      const openingHour = await this.pricingRepo.findBranchOpeningHour(
        court.branchId,
        dayOfWeek,
        tx,
      );
      if (
        court.branchStatus !== 'ACTIVE' ||
        hasHoliday ||
        !openingHour ||
        openingHour.isClosed ||
        !openingHour.openTime ||
        !openingHour.closeTime
      ) {
        throw new AppError('BRANCH_CLOSED');
      }

      // 3. Within [OpenTime, CloseTime)
      const openMin = parseTimeToMinutes(openingHour.openTime);
      const closeMin = parseTimeToMinutes(openingHour.closeTime);
      if (startMin < openMin || endMin > closeMin) {
        throw new AppError('OUTSIDE_OPENING_HOURS');
      }

      // 4. Booking must start strictly in the future
      if (startAt.getTime() <= now.getTime()) {
        throw new AppError('BOOKING_IN_PAST');
      }

      // 5. GridBlockMinutes check
      const durationMinutes = endMin - startMin;
      if (
        startMin % court.gridBlockMinutes !== 0 ||
        durationMinutes % court.gridBlockMinutes !== 0
      ) {
        throw new AppError('INVALID_TIME_STEP');
      }

      // 6. Pricing rules (R-10)
      const rules = await this.pricingRepo.findActivePriceRules(court.courtId, now, tx);
      const rental = calculateRentalPrice({
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        now,
        rules,
      });

      // 7. Promotion validation
      const rawPromo = dto.promotionCode?.trim();
      const promoCode = rawPromo && rawPromo.length > 0 ? rawPromo.toUpperCase() : null;
      let promoId: number | null = null;
      let appliedPromoCode: string | null = null;
      let discountAmount = 0;

      if (promoCode) {
        const promoRecord = await this.pricingRepo.findPromotionForQuote(
          promoCode,
          court.branchId,
          court.sportId,
          customerUserId,
          tx,
        );
        const promoEval = evaluatePromotion({
          code: promoCode,
          promo: promoRecord
            ? {
                promotionId: promoRecord.promotionId,
                code: promoRecord.code,
                name: promoRecord.name,
                status: promoRecord.status,
                discountType: promoRecord.discountType,
                discountValue: promoRecord.discountValue,
                maxDiscountAmount: promoRecord.maxDiscountAmount,
                startDate: promoRecord.startDate,
                endDate: promoRecord.endDate,
                timeFrom: promoRecord.timeFrom,
                timeTo: promoRecord.timeTo,
                allBranches: promoRecord.allBranches,
                allSports: promoRecord.allSports,
                audienceType: promoRecord.audienceType,
                maxUses: promoRecord.maxUses,
                usedCount: promoRecord.usedCount,
              }
            : null,
          date: dto.date,
          startTime: dto.startTime,
          endTime: dto.endTime,
          baseAmount: rental.baseAmount,
          isGuest: customerUserId === null,
          isBranchEligible: promoRecord?.isBranchEligible ?? false,
          isSportEligible: promoRecord?.isSportEligible ?? false,
          isCustomerEligible: promoRecord?.isCustomerEligible ?? false,
        });

        if (!promoEval.applied || !promoRecord) {
          throw new AppError('PROMO_INVALID', {
            message: promoEval.message,
            details: { reasonCode: promoEval.reasonCode },
          });
        }

        promoId = promoRecord.promotionId;
        appliedPromoCode = promoRecord.code;
        discountAmount = promoEval.discountAmount;
      }

      // 8. Deposit / Total / R-09
      const quoteAmounts = calculateQuoteAmounts({
        baseAmount: rental.baseAmount,
        discountAmount,
        paymentOption: dto.paymentOption,
        depositType: court.depositType,
        depositValue: court.depositValue,
      });
      assertPaymentOptionAllowed(dto.paymentOption, quoteAmounts.fullPaymentRequired);

      const isZeroTotal = quoteAmounts.totalAmount === 0;
      const hasCashPayment = dto.payment !== null && dto.payment !== undefined;

      if (hasCashPayment && dto.payment!.amount !== quoteAmounts.amountDueNow) {
        throw new AppError('AMOUNT_MISMATCH');
      }

      // 9. Persist Booking + BookingSlots + PriceLines + History
      const bookingCode = await nextCode(tx, 'BK', toDateKey(now));
      const initialStatus = isZeroTotal ? 'CONFIRMED' : 'PENDING_PAYMENT';
      const initialPaymentStatus = isZeroTotal ? 'PAID' : 'UNPAID';
      // R-03: HoldExpireAt = min(now + BOOKING_HOLD_MINUTES, StartAt)
      const holdExpireAt = isZeroTotal
        ? null
        : new Date(Math.min(addMinutes(now, holdMinutes).getTime(), startAt.getTime()));

      const note = dto.note && dto.note.length > 0 ? dto.note : null;

      const bookingId = await this.bookingsRepo.insertBooking(tx, {
        bookingCode,
        branchId: court.branchId,
        courtId: court.courtId,
        customerUserId,
        guestName,
        guestPhone,
        startAt,
        endAt,
        baseAmount: rental.baseAmount,
        discountAmount,
        totalAmount: quoteAmounts.totalAmount,
        paymentOption: dto.paymentOption,
        depositType: court.depositType,
        depositValue: court.depositValue,
        depositAmount: quoteAmounts.depositAmount,
        amountDueNow: quoteAmounts.amountDueNow,
        paidAmount: 0,
        remainingAmount: quoteAmounts.totalAmount,
        status: initialStatus,
        paymentStatus: initialPaymentStatus,
        holdExpireAt,
        promotionCode: appliedPromoCode,
        note,
        createdBy: caller.userId,
        now,
        channel: 'COUNTER',
      });

      const slotStarts: Date[] = [];
      for (
        let cur = startAt.getTime();
        cur < endAt.getTime();
        cur += court.gridBlockMinutes * 60_000
      ) {
        slotStarts.push(new Date(cur));
      }
      await this.bookingsRepo.insertBookingSlots(tx, bookingId, court.courtId, slotStarts);

      await this.bookingsRepo.insertBookingPriceLines(
        tx,
        rental.priceLines.map((line) => ({
          bookingId,
          priceRuleId: line.priceRuleId,
          startAt: parseVnDateTime(dto.date, line.startTime),
          endAt: parseVnDateTime(dto.date, line.endTime),
          pricePerHour: line.pricePerHour,
          amount: line.amount,
        })),
      );

      await this.bookingsRepo.insertStatusHistory(tx, {
        bookingId,
        fromStatus: null,
        toStatus: initialStatus,
        fromPaymentStatus: null,
        toPaymentStatus: initialPaymentStatus,
        changedBy: caller.userId,
        changedAt: now,
        note: isZeroTotal
          ? 'Đặt tại quầy – miễn phí 100%'
          : customerUserId === null
            ? 'Đặt tại quầy – khách vãng lai'
            : 'Đặt tại quầy – hội viên',
      });

      if (promoId !== null) {
        const okPromo = await this.bookingsRepo.incrementPromotionUsedCount(tx, promoId, now);
        if (!okPromo) {
          throw new AppError('PROMO_EXHAUSTED');
        }
      }

      let receipt: ReceiptDto | null = null;

      if (!isZeroTotal && hasCashPayment) {
        const pendingRow = await this.bookingsRepo.findByCode(tx, bookingCode);
        if (!pendingRow) {
          throw new AppError('INTERNAL_ERROR');
        }

        const purpose = dto.paymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL';
        const paymentRes = await this.bookingState.applyPaymentInTx(tx, pendingRow, {
          purpose,
          method: 'CASH',
          channel: 'COUNTER',
          amount: dto.payment!.amount,
          collectedBy: caller.userId,
          paidAt: now,
          historyNote: 'Thu tiền mặt tại quầy',
          historyChangedBy: caller.userId,
        });

        const collectedByName = await this.repo.findUserFullNameById(tx, caller.userId);
        const customerName =
          pendingRow.CustomerUserId !== null
            ? (pendingRow.CustomerUserName ?? '')
            : (pendingRow.GuestName ?? '');
        const customerPhone =
          pendingRow.CustomerUserId !== null
            ? (pendingRow.CustomerUserPhone ?? '')
            : (pendingRow.GuestPhone ?? '');

        receipt = {
          paymentCode: paymentRes.paymentCode,
          bookingCode,
          purpose,
          method: 'CASH',
          channel: 'COUNTER',
          amount: dto.payment!.amount,
          paidAt: toIsoVn(now),
          collectedByName,
          branchName: pendingRow.BranchName,
          courtName: pendingRow.CourtName,
          customerName,
          customerPhone,
          startAt: toIsoVn(startAt),
          endAt: toIsoVn(endAt),
        };

        if (customerUserId !== null) {
          const formattedAmount = formatVnd(dto.payment!.amount);
          await this.notificationsService.createNotificationInTx(tx, {
            userId: customerUserId,
            type: 'PAYMENT_RESULT',
            title:
              purpose === 'DEPOSIT' ? 'Đã nhận tiền cọc đặt sân' : 'Thanh toán đặt sân thành công',
            body:
              purpose === 'DEPOSIT'
                ? `Đơn ${bookingCode} tại quầy đã xác nhận đặt cọc ${formattedAmount}đ.`
                : `Đơn ${bookingCode} tại quầy đã thanh toán đủ ${formattedAmount}đ.`,
            linkType: 'BOOKING',
            linkRef: String(bookingId),
            bookingCode,
          });
        }
      }

      const finalRow = await this.bookingsRepo.findByCode(tx, bookingCode);
      if (!finalRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(finalRow, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      });

      tx.events.push({
        rooms: [`availability:${court.branchId}:${dto.date}`, `branch:${court.branchId}`],
        event: 'slot.updated',
        payload: {
          branchId: court.branchId,
          courtId: court.courtId,
          date: dto.date,
          startTime: dto.startTime,
          endTime: dto.endTime,
          state: summary.status === 'CONFIRMED' ? 'BOOKED' : 'HELD',
        },
      });

      if (receipt !== null) {
        const targetRooms = [
          `booking:${bookingCode}`,
          `branch:${court.branchId}`,
          ...(customerUserId !== null ? [`user:${customerUserId}`] : []),
        ];
        tx.events.push({
          rooms: targetRooms,
          event: 'booking.paid',
          payload: {
            bookingCode,
            paymentCode: receipt.paymentCode,
            purpose: receipt.purpose,
            method: 'CASH',
            amount: receipt.amount,
            status: summary.status,
            paymentStatus: summary.paymentStatus,
          },
        });
        tx.events.push({
          rooms: targetRooms,
          event: 'booking.updated',
          payload: {
            bookingCode,
            status: summary.status,
            paymentStatus: summary.paymentStatus,
            paidAmount: summary.paidAmount,
            remainingAmount: summary.remainingAmount,
            isOverdue: summary.isOverdue,
            version: summary.version,
          },
        });
      }

      return { booking: summary, receipt };
    });
  }

  // API-29: Collect cash for PENDING_PAYMENT booking
  async collectCashPayment(
    bookingCode: string,
    dto: PosCashPaymentDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto; receipt: ReceiptDto }> {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const booking = await this.bookingState.lockBookingByCode(tx, bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(booking, caller);

      if (!booking.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }
      if (booking.Status !== 'PENDING_PAYMENT') {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      const holdExpireAt =
        booking.HoldExpireAt !== null ? fromSqlDateTime(booking.HoldExpireAt) : null;
      if (holdExpireAt && now.getTime() > holdExpireAt.getTime()) {
        throw new AppError('HOLD_EXPIRED', 'Đơn đã quá hạn giữ chỗ.');
      }

      if (dto.amount !== Number(booking.AmountDueNow)) {
        throw new AppError('AMOUNT_MISMATCH', 'Số tiền thu phải bằng đúng số tiền cần thu.');
      }

      const bookingId = Number(booking.BookingId);
      await this.paymentsService.cancelPendingRequestsInTx(tx, bookingId);

      const purpose = booking.PaymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL';
      const paymentRes = await this.bookingState.applyPaymentInTx(tx, booking, {
        purpose,
        method: 'CASH',
        channel: 'COUNTER',
        amount: dto.amount,
        collectedBy: caller.userId,
        paidAt: now,
        expectedVersion,
        historyNote: 'Chuyển thu tiền mặt tại quầy',
        historyChangedBy: caller.userId,
      });

      const customerUserId =
        booking.CustomerUserId !== null ? Number(booking.CustomerUserId) : null;
      if (customerUserId !== null) {
        const formattedAmount = formatVnd(dto.amount);
        await this.notificationsService.createNotificationInTx(tx, {
          userId: customerUserId,
          type: 'PAYMENT_RESULT',
          title:
            purpose === 'DEPOSIT' ? 'Đã nhận tiền cọc đặt sân' : 'Thanh toán đặt sân thành công',
          body:
            purpose === 'DEPOSIT'
              ? `Đơn ${booking.BookingCode} đã được xác nhận đặt cọc ${formattedAmount}đ tại quầy.`
              : `Đơn ${booking.BookingCode} đã được xác nhận thanh toán đủ ${formattedAmount}đ tại quầy.`,
          linkType: 'BOOKING',
          linkRef: String(bookingId),
          bookingCode: booking.BookingCode,
        });
      }

      const updatedRow = await this.bookingsRepo.findByCode(tx, bookingCode);
      if (!updatedRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(updatedRow, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      });

      const collectedByName = await this.repo.findUserFullNameById(tx, caller.userId);
      const startAt = fromSqlDateTime(updatedRow.StartAt);
      const endAt = fromSqlDateTime(updatedRow.EndAt);
      const receipt: ReceiptDto = {
        paymentCode: paymentRes.paymentCode,
        bookingCode: updatedRow.BookingCode,
        purpose,
        method: 'CASH',
        channel: 'COUNTER',
        amount: dto.amount,
        paidAt: toIsoVn(now),
        collectedByName,
        branchName: updatedRow.BranchName,
        courtName: updatedRow.CourtName,
        customerName: summary.customerName,
        customerPhone: summary.customerPhone,
        startAt: toIsoVn(startAt),
        endAt: toIsoVn(endAt),
      };

      const branchId = Number(updatedRow.BranchId);
      const targetRooms = [
        `booking:${updatedRow.BookingCode}`,
        `branch:${branchId}`,
        ...(customerUserId !== null ? [`user:${customerUserId}`] : []),
      ];

      tx.events.push({
        rooms: targetRooms,
        event: 'booking.paid',
        payload: {
          bookingCode: updatedRow.BookingCode,
          paymentCode: receipt.paymentCode,
          purpose,
          method: 'CASH',
          amount: dto.amount,
          status: summary.status,
          paymentStatus: summary.paymentStatus,
        },
      });
      tx.events.push({
        rooms: targetRooms,
        event: 'booking.updated',
        payload: {
          bookingCode: summary.bookingCode,
          status: summary.status,
          paymentStatus: summary.paymentStatus,
          paidAmount: summary.paidAmount,
          remainingAmount: summary.remainingAmount,
          isOverdue: summary.isOverdue,
          version: summary.version,
        },
      });
      tx.events.push({
        rooms: [`availability:${branchId}:${summary.date}`, `branch:${branchId}`],
        event: 'slot.updated',
        payload: {
          branchId,
          courtId: summary.courtId,
          date: summary.date,
          startTime: summary.startTime,
          endTime: summary.endTime,
          state: 'BOOKED',
        },
      });

      return { booking: summary, receipt };
    });
  }

  // API-30: Abort counter booking (PENDING_PAYMENT, PaidAmount = 0, Channel = COUNTER)
  async abortCounterBooking(
    bookingCode: string,
    dto: PosAbortDto,
    caller: AuthenticatedUser,
  ): Promise<{ bookingCode: string; status: 'CANCELED'; cancelType: 'COUNTER_ABORT' }> {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const booking = await this.bookingState.lockBookingByCode(tx, bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(booking, caller);

      if (!booking.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (
        booking.Channel !== 'COUNTER' ||
        booking.Status !== 'PENDING_PAYMENT' ||
        Number(booking.PaidAmount) !== 0
      ) {
        throw new AppError(
          'BOOKING_NOT_CANCELABLE',
          'Đơn đã thu tiền hoặc không phải đơn tại quầy.',
        );
      }

      const bookingId = Number(booking.BookingId);
      const cancelReason =
        dto.reason && dto.reason.length > 0 ? dto.reason : 'Khách bỏ đi, chưa thanh toán';

      const newRowVer = await this.bookingsRepo.updateBookingCanceled(tx, {
        bookingId,
        expectedVersion,
        cancelType: 'COUNTER_ABORT',
        cancelReason,
        canceledBy: caller.userId,
        canceledAt: now,
        refundRate: null,
        refundAmount: null,
      });

      await this.bookingsRepo.deactivateBookingSlots(tx, bookingId);
      await this.paymentsService.cancelPendingRequestsInTx(tx, bookingId);

      if (booking.PromotionCode) {
        await this.bookingsRepo.decrementPromotionUsedCount(tx, booking.PromotionCode, now);
      }

      await this.bookingsRepo.insertStatusHistory(tx, {
        bookingId,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELED',
        fromPaymentStatus: booking.PaymentStatus,
        toPaymentStatus: booking.PaymentStatus,
        changedBy: caller.userId,
        changedAt: now,
        note: cancelReason,
      });

      const branchId = Number(booking.BranchId);
      const startAt = fromSqlDateTime(booking.StartAt);
      const endAt = fromSqlDateTime(booking.EndAt);
      const date = formatDateVn(startAt);
      const startTime = formatTimeVn(startAt);
      const endTime = formatTimeVn(endAt);

      const bookingRooms = [`booking:${booking.BookingCode}`, `branch:${branchId}`];
      if (booking.CustomerUserId !== null) {
        bookingRooms.push(`user:${Number(booking.CustomerUserId)}`);
      }

      tx.events.push({
        rooms: bookingRooms,
        event: 'booking.updated',
        payload: {
          bookingCode: booking.BookingCode,
          status: 'CANCELED',
          paymentStatus: booking.PaymentStatus,
          paidAmount: 0,
          remainingAmount: 0,
          isOverdue: false,
          version: encodeRowVer(newRowVer),
        },
      });
      tx.events.push({
        rooms: [`availability:${branchId}:${date}`, `branch:${branchId}`],
        event: 'slot.updated',
        payload: {
          branchId,
          courtId: Number(booking.CourtId),
          date,
          startTime,
          endTime,
          state: 'FREE',
        },
      });

      return {
        bookingCode: booking.BookingCode,
        status: 'CANCELED',
        cancelType: 'COUNTER_ABORT',
      };
    });
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

  // API-33: Settle remaining balance (CASH) and optionally check in immediately
  async settleBooking(
    bookingCode: string,
    dto: PosSettleDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto; receipt: ReceiptDto }> {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const booking = await this.bookingState.lockBookingByCode(tx, bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(booking, caller);

      if (!booking.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (booking.Status !== 'CONFIRMED') {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      const remainingAmount = Number(booking.RemainingAmount);
      if (remainingAmount <= 0) {
        throw new AppError('NOTHING_TO_PAY', 'Đơn đã thanh toán đủ — dùng API Nhận sân.');
      }

      if (dto.amount !== remainingAmount) {
        throw new AppError('AMOUNT_MISMATCH', 'Số tiền thu phải bằng đúng số tiền còn lại.');
      }

      const startAt = fromSqlDateTime(booking.StartAt);
      const endAt = fromSqlDateTime(booking.EndAt);
      if (formatDateVn(startAt) !== formatDateVn(now)) {
        if (startAt.getTime() > now.getTime()) {
          throw new AppError('CHECK_IN_TOO_EARLY', 'Chưa đến ngày chơi của đơn.');
        }
        throw new AppError('INVALID_STATE_TRANSITION', 'Đơn không thuộc ngày hôm nay.');
      }

      const bookingId = Number(booking.BookingId);

      // Check check-in preconditions and COURT_IN_USE BEFORE taking cash!
      if (dto.checkIn) {
        if (now.getTime() < addMinutes(startAt, -15).getTime()) {
          throw new AppError(
            'CHECK_IN_TOO_EARLY',
            'Chưa đến thời gian cho phép nhận sân (tối đa trước giờ chơi 15 phút).',
          );
        }

        const blockingBookingCode = await this.repo.findActiveInUseBookingOnCourt(
          tx,
          Number(booking.CourtId),
          bookingId,
        );
        if (blockingBookingCode) {
          throw new AppError('COURT_IN_USE', {
            message: `Sân đang được sử dụng bởi đơn trước (#${blockingBookingCode}). Vui lòng chờ khách trước trả sân.`,
            details: { blockingBookingCode },
          });
        }
      }

      await this.paymentsService.cancelPendingRequestsInTx(tx, bookingId);

      const paymentRes = await this.bookingState.applyPaymentInTx(tx, booking, {
        purpose: 'REMAINING',
        method: 'CASH',
        channel: 'COUNTER',
        amount: dto.amount,
        collectedBy: caller.userId,
        paidAt: now,
        expectedVersion,
        historyNote: 'Tất toán tiền mặt tại quầy',
        historyChangedBy: caller.userId,
      });

      if (dto.checkIn) {
        const nextVerBuf = decodeRowVer(paymentRes.version);
        if (!nextVerBuf) {
          throw new AppError('INTERNAL_ERROR');
        }

        await this.repo.updateBookingCheckedIn(tx, {
          bookingId,
          expectedVersion: nextVerBuf,
          now,
        });

        await this.bookingsRepo.insertStatusHistory(tx, {
          bookingId,
          fromStatus: 'CONFIRMED',
          toStatus: 'IN_USE',
          fromPaymentStatus: paymentRes.nextPaymentStatus,
          toPaymentStatus: paymentRes.nextPaymentStatus,
          changedBy: caller.userId,
          changedAt: now,
          note: 'Nhận sân',
        });
      }

      const customerUserId =
        booking.CustomerUserId !== null ? Number(booking.CustomerUserId) : null;
      if (customerUserId !== null) {
        await this.notificationsService.createNotificationInTx(tx, {
          userId: customerUserId,
          type: 'PAYMENT_RESULT',
          title: 'Thanh toán phần còn lại thành công',
          body: `Đơn ${booking.BookingCode} đã tất toán ${formatVnd(dto.amount)}đ tại quầy.`,
          linkType: 'BOOKING',
          linkRef: String(bookingId),
          bookingCode: booking.BookingCode,
        });
      }

      const updatedRow = await this.bookingsRepo.findByCode(tx, bookingCode);
      if (!updatedRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(updatedRow, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      });

      const collectedByName = await this.repo.findUserFullNameById(tx, caller.userId);
      const receipt: ReceiptDto = {
        paymentCode: paymentRes.paymentCode,
        bookingCode: updatedRow.BookingCode,
        purpose: 'REMAINING',
        method: 'CASH',
        channel: 'COUNTER',
        amount: dto.amount,
        paidAt: toIsoVn(now),
        collectedByName,
        branchName: updatedRow.BranchName,
        courtName: updatedRow.CourtName,
        customerName: summary.customerName,
        customerPhone: summary.customerPhone,
        startAt: toIsoVn(startAt),
        endAt: toIsoVn(endAt),
      };

      const branchId = Number(updatedRow.BranchId);
      const targetRooms = [
        `booking:${updatedRow.BookingCode}`,
        `branch:${branchId}`,
        ...(customerUserId !== null ? [`user:${customerUserId}`] : []),
      ];

      tx.events.push({
        rooms: targetRooms,
        event: 'booking.paid',
        payload: {
          bookingCode: updatedRow.BookingCode,
          paymentCode: receipt.paymentCode,
          purpose: 'REMAINING',
          method: 'CASH',
          amount: dto.amount,
          status: summary.status,
          paymentStatus: summary.paymentStatus,
        },
      });
      tx.events.push({
        rooms: targetRooms,
        event: 'booking.updated',
        payload: {
          bookingCode: summary.bookingCode,
          status: summary.status,
          paymentStatus: summary.paymentStatus,
          paidAmount: summary.paidAmount,
          remainingAmount: summary.remainingAmount,
          isOverdue: summary.isOverdue,
          version: summary.version,
        },
      });

      if (dto.checkIn) {
        tx.events.push({
          rooms: [`availability:${branchId}:${summary.date}`, `branch:${branchId}`],
          event: 'slot.updated',
          payload: {
            branchId,
            courtId: summary.courtId,
            date: summary.date,
            startTime: summary.startTime,
            endTime: summary.endTime,
            state: 'IN_USE',
          },
        });
      }

      return { booking: summary, receipt };
    });
  }

  // API-34: Check in paid booking
  async checkInBooking(
    bookingCode: string,
    dto: PosCheckInDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto }> {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const booking = await this.bookingState.lockBookingByCode(tx, bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(booking, caller);

      if (!booking.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (booking.Status !== 'CONFIRMED') {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (Number(booking.RemainingAmount) > 0) {
        throw new AppError('PAYMENT_INCOMPLETE');
      }

      const startAt = fromSqlDateTime(booking.StartAt);
      if (
        formatDateVn(startAt) !== formatDateVn(now) ||
        now.getTime() < addMinutes(startAt, -15).getTime()
      ) {
        throw new AppError('CHECK_IN_TOO_EARLY');
      }

      const bookingId = Number(booking.BookingId);
      const blockingBookingCode = await this.repo.findActiveInUseBookingOnCourt(
        tx,
        Number(booking.CourtId),
        bookingId,
      );
      if (blockingBookingCode) {
        throw new AppError('COURT_IN_USE', {
          message: `Sân đang được sử dụng bởi đơn trước (#${blockingBookingCode}). Vui lòng chờ khách trước trả sân.`,
          details: { blockingBookingCode },
        });
      }

      await this.repo.updateBookingCheckedIn(tx, {
        bookingId,
        expectedVersion,
        now,
      });

      await this.bookingsRepo.insertStatusHistory(tx, {
        bookingId,
        fromStatus: 'CONFIRMED',
        toStatus: 'IN_USE',
        fromPaymentStatus: booking.PaymentStatus,
        toPaymentStatus: booking.PaymentStatus,
        changedBy: caller.userId,
        changedAt: now,
        note: 'Nhận sân',
      });

      const updatedRow = await this.bookingsRepo.findByCode(tx, bookingCode);
      if (!updatedRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(updatedRow, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      });

      const branchId = Number(updatedRow.BranchId);
      const customerUserId = summary.customerUserId;
      const bookingRooms = [
        `booking:${summary.bookingCode}`,
        `branch:${branchId}`,
        ...(customerUserId !== null ? [`user:${customerUserId}`] : []),
      ];

      tx.events.push({
        rooms: bookingRooms,
        event: 'booking.updated',
        payload: {
          bookingCode: summary.bookingCode,
          status: summary.status,
          paymentStatus: summary.paymentStatus,
          paidAmount: summary.paidAmount,
          remainingAmount: summary.remainingAmount,
          isOverdue: summary.isOverdue,
          version: summary.version,
        },
      });
      tx.events.push({
        rooms: [`availability:${branchId}:${summary.date}`, `branch:${branchId}`],
        event: 'slot.updated',
        payload: {
          branchId,
          courtId: summary.courtId,
          date: summary.date,
          startTime: summary.startTime,
          endTime: summary.endTime,
          state: 'IN_USE',
        },
      });

      return { booking: summary };
    });
  }

  // API-35: Complete booking early
  async completeBooking(
    bookingCode: string,
    dto: PosCompleteDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto }> {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const booking = await this.bookingState.lockBookingByCode(tx, bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(booking, caller);

      if (!booking.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (booking.Status !== 'IN_USE') {
        throw new AppError('BOOKING_NOT_IN_USE');
      }

      const bookingId = Number(booking.BookingId);
      await this.repo.updateBookingCompleted(tx, {
        bookingId,
        expectedVersion,
        now,
      });

      const freedSlotStarts = await this.repo.deactivateFutureSlots(tx, bookingId, now);

      const noteText = dto.note?.trim() ? `Kết thúc sớm: ${dto.note.trim()}` : 'Kết thúc lượt chơi sớm';
      await this.bookingsRepo.insertStatusHistory(tx, {
        bookingId,
        fromStatus: 'IN_USE',
        toStatus: 'COMPLETED',
        fromPaymentStatus: booking.PaymentStatus,
        toPaymentStatus: booking.PaymentStatus,
        changedBy: caller.userId,
        changedAt: now,
        note: noteText,
      });

      const updatedRow = await this.bookingsRepo.findByCode(tx, bookingCode);
      if (!updatedRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(updatedRow, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      });

      const branchId = Number(updatedRow.BranchId);
      const bookingRooms = [
        `booking:${summary.bookingCode}`,
        `branch:${branchId}`,
        ...(summary.customerUserId !== null ? [`user:${summary.customerUserId}`] : []),
      ];

      tx.events.push({
        rooms: bookingRooms,
        event: 'booking.updated',
        payload: {
          bookingCode: summary.bookingCode,
          status: summary.status,
          paymentStatus: summary.paymentStatus,
          paidAmount: summary.paidAmount,
          remainingAmount: summary.remainingAmount,
          isOverdue: summary.isOverdue,
          version: summary.version,
        },
      });

      if (freedSlotStarts.length > 0) {
        freedSlotStarts.sort((a, b) => a.getTime() - b.getTime());
        tx.events.push({
          rooms: [`availability:${branchId}:${summary.date}`, `branch:${branchId}`],
          event: 'slot.updated',
          payload: {
            branchId,
            courtId: summary.courtId,
            date: summary.date,
            startTime: formatTimeVn(freedSlotStarts[0]),
            endTime: summary.endTime,
            state: 'FREE',
          },
        });
      }

      return { booking: summary };
    });
  }
}
