import { Inject, Injectable, Optional } from '@nestjs/common';
import type { BookingStatus } from '@sporthub/shared/enums';
import { ERROR_CATALOG } from '@sporthub/shared/errors';
import type {
  BookingDetailDto,
  BookingRefundSummaryDto,
  BookingSummaryDto,
  PaymentRequestDto,
} from '@sporthub/shared/types';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { nextCode } from '../core/codes.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { AppLogger } from '../core/logger.js';
import { SettingsService } from '../core/settings.service.js';
import {
  addMinutes,
  buildBookingSlotStarts,
  diffSeconds,
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
  parseTimeToMinutes,
  parseVnDateTime,
  toDateKey,
  toSqlDate,
  vnDayOfWeek,
} from '../core/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  assertPaymentOptionAllowed,
  calculateQuoteAmounts,
  calculateRefund,
  calculateRentalPrice,
  evaluatePromotion,
} from '../pricing/pricing.engine.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { BookingStateService } from './booking-state.service.js';
import {
  decodeRowVer,
  encodeRowVer,
  toBookingDetailDto,
  toBookingSummaryDto,
} from './bookings.mapper.js';
import { BookingsRepository } from './bookings.repository.js';
import type {
  CancelBookingDto,
  CreateOnlineBookingDto,
  MyBookingsQuery,
} from './bookings.schemas.js';

export interface CreateOnlineBookingResult {
  booking: BookingSummaryDto;
  paymentRequest: PaymentRequestDto | null;
}

export interface MyBookingsListResult {
  items: BookingSummaryDto[];
  totalItems: number;
  statusCounts: Record<'ALL' | BookingStatus, number>;
}

export interface CancelPreviewResult {
  cancelType: 'CUSTOMER_REQUEST' | 'NO_SHOW';
  canCancel: boolean;
  reasonIfNot: string | null;
  daysBeforeStart: number;
  paidAmount: number;
  depositKept: number;
  refundableBase: number;
  refundRate: number | null;
  refundAmount: number | null;
  retainedAmount: number;
  policyText: string;
}

export interface CancelBookingResult {
  booking: BookingSummaryDto;
  refund: BookingRefundSummaryDto | null;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly repo: BookingsRepository,
    private readonly bookingState: BookingStateService,
    private readonly pricingRepo: PricingRepository,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly logger?: AppLogger,
  ) {}

  // API-13, UC 004 / 007 / 008, SDD 3.5a-d
  async createOnlineBooking(
    dto: CreateOnlineBookingDto,
    caller: AuthenticatedUser,
  ): Promise<CreateOnlineBookingResult> {
    if (caller.role !== 'CUSTOMER') {
      throw new AppError('FORBIDDEN');
    }

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
      // 1. Court exists, ACTIVE, and no overlapping active CourtBlocks
      const court = await this.pricingRepo.findCourtContext(dto.courtId, tx);
      if (!court) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
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

      // 2. Branch ACTIVE, no holiday, opening hours not closed
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

      // 5. Start time and duration must align with sport's GridBlockMinutes
      const durationMinutes = endMin - startMin;
      if (
        startMin % court.gridBlockMinutes !== 0 ||
        durationMinutes % court.gridBlockMinutes !== 0
      ) {
        throw new AppError('INVALID_TIME_STEP');
      }

      // 6. Rental pricing must cover the full duration (R-10: effective at creation `now`)
      const rules = await this.pricingRepo.findActivePriceRules(court.courtId, now, tx);
      const rental = calculateRentalPrice({
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        now,
        rules,
      });

      // 7. Promotion validation (8-step priority order)
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
          caller.userId,
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
          isGuest: false,
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

      // 8. Deposit / Total / R-09 guard
      const quoteAmounts = calculateQuoteAmounts({
        baseAmount: rental.baseAmount,
        discountAmount,
        paymentOption: dto.paymentOption,
        depositType: court.depositType,
        depositValue: court.depositValue,
      });
      assertPaymentOptionAllowed(dto.paymentOption, quoteAmounts.fullPaymentRequired);

      // 9. Generate BookingCode and persist Booking + BookingSlots + PriceLines + History
      const bookingCode = await nextCode(tx, 'BK', toDateKey(now));
      const isZeroTotal = quoteAmounts.totalAmount === 0;
      const status = isZeroTotal ? 'CONFIRMED' : 'PENDING_PAYMENT';
      const paymentStatus = isZeroTotal ? 'PAID' : 'UNPAID';
      // R-03: HoldExpireAt = min(now + BOOKING_HOLD_MINUTES, StartAt)
      const holdExpireAt = isZeroTotal
        ? null
        : new Date(Math.min(addMinutes(now, holdMinutes).getTime(), startAt.getTime()));

      const note = dto.note && dto.note.length > 0 ? dto.note : null;

      const bookingId = await this.repo.insertBooking(tx, {
        bookingCode,
        branchId: court.branchId,
        courtId: court.courtId,
        customerUserId: caller.userId,
        guestName: null,
        guestPhone: null,
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
        status,
        paymentStatus,
        holdExpireAt,
        promotionCode: appliedPromoCode,
        note,
        createdBy: caller.userId,
        now,
        channel: 'ONLINE',
      });

      const slotStarts = buildBookingSlotStarts(startAt, endAt, court.gridBlockMinutes);
      // Enforces UX_BookingSlots_Court_Slot -> 409 SLOT_TAKEN
      await this.repo.insertBookingSlots(tx, bookingId, court.courtId, slotStarts);

      await this.repo.insertBookingPriceLines(
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

      await this.repo.insertStatusHistory(tx, {
        bookingId,
        fromStatus: null,
        toStatus: status,
        fromPaymentStatus: null,
        toPaymentStatus: paymentStatus,
        changedBy: caller.userId,
        changedAt: now,
        note: 'Khách đặt trực tuyến',
      });

      // 10. Atomic promotion UsedCount increment (rolls back booking & slots if exhausted)
      if (promoId !== null) {
        const okPromo = await this.repo.incrementPromotionUsedCount(tx, promoId, now);
        if (!okPromo) {
          throw new AppError('PROMO_EXHAUSTED');
        }
      }

      let paymentRequest: PaymentRequestDto | null = null;
      if (quoteAmounts.totalAmount > 0) {
        paymentRequest = await this.paymentsService.createPaymentRequestInTx(tx, {
          bookingId,
          bookingCode,
          branchId: court.branchId,
          purpose: dto.paymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL',
          amount: quoteAmounts.amountDueNow,
          expiresAt: holdExpireAt!,
          createdBy: caller.userId,
        });
      }

      const createdRow = await this.repo.findByCode(tx, bookingCode);
      if (!createdRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(createdRow, {
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
          state: status === 'CONFIRMED' ? 'BOOKED' : 'HELD',
        },
      });

      return {
        booking: summary,
        paymentRequest,
      };
    });
  }

  // API-14
  async getBookingDetail(
    bookingCode: string,
    caller: AuthenticatedUser,
  ): Promise<BookingDetailDto> {
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const exec = await this.txService.executor();
    const row = await this.bookingState.getBookingForAccess(exec, bookingCode, caller);
    const relations = await this.repo.findDetailRelations(exec, Number(row.BookingId));

    return toBookingDetailDto(row, relations, {
      callerRole: caller.role,
      callerUserId: caller.userId,
      now: this.clock.now(),
      noShowGraceMinutes,
    });
  }

  // API-19
  async listMyBookings(
    query: MyBookingsQuery,
    caller: AuthenticatedUser,
  ): Promise<MyBookingsListResult> {
    if (caller.role !== 'CUSTOMER') {
      throw new AppError('FORBIDDEN');
    }

    const fromDate = toSqlDate(query.from);
    const toDate = toSqlDate(query.to);
    const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    if (fromDate.getTime() > toDate.getTime() || diffDays > 366) {
      throw new AppError('INVALID_DATE_RANGE');
    }

    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const exec = await this.txService.executor();
    const result = await this.repo.listCustomerBookings(exec, {
      customerUserId: caller.userId,
      from: query.from,
      to: query.to,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    const now = this.clock.now();
    const items = result.rows.map((row) =>
      toBookingSummaryDto(row, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      }),
    );

    return {
      items,
      totalItems: result.totalItems,
      statusCounts: result.statusCounts,
    };
  }

  // API-20, UC 009
  async getCancelPreview(
    bookingCode: string,
    cancelType: 'CUSTOMER_REQUEST' | 'NO_SHOW',
    caller: AuthenticatedUser,
  ): Promise<CancelPreviewResult> {
    if (cancelType === 'NO_SHOW' && caller.role === 'CUSTOMER') {
      throw new AppError('FORBIDDEN');
    }

    const [refundFullDays, refundHalfDays, refundHalfRate, noShowGraceMinutes] =
      await Promise.all([
        this.settingsService.getInt('REFUND_FULL_DAYS'),
        this.settingsService.getInt('REFUND_HALF_DAYS'),
        this.settingsService.getInt('REFUND_HALF_RATE'),
        this.settingsService.getInt('NO_SHOW_GRACE_MINUTES'),
      ]);

    const exec = await this.txService.executor();
    const row = await this.bookingState.getBookingForAccess(exec, bookingCode, caller);

    const now = this.clock.now();
    const startAt = fromSqlDateTime(row.StartAt);
    const endAt = fromSqlDateTime(row.EndAt);

    let canCancel = true;
    let reasonIfNot: string | null = null;

    if (row.Status !== 'PENDING_PAYMENT' && row.Status !== 'CONFIRMED') {
      canCancel = false;
      reasonIfNot = ERROR_CATALOG.BOOKING_NOT_CANCELABLE.defaultMessage;
    } else if (cancelType === 'CUSTOMER_REQUEST') {
      if (now.getTime() >= startAt.getTime()) {
        canCancel = false;
        reasonIfNot = ERROR_CATALOG.BOOKING_NOT_CANCELABLE.defaultMessage;
      }
    } else {
      // NO_SHOW
      if (row.Status === 'PENDING_PAYMENT') {
        canCancel = false;
        reasonIfNot =
          'Đơn chưa xác nhận (Chờ thanh toán), không áp dụng hủy Khách không đến nhận sân.';
      } else if (row.PaymentStatus === 'DEPOSITED') {
        if (now.getTime() < addMinutes(startAt, noShowGraceMinutes).getTime()) {
          canCancel = false;
          reasonIfNot = `Chưa quá giờ nhận sân quy định (${noShowGraceMinutes} phút) — không thể chọn 'Khách không đến nhận sân'.`;
        }
      } else if (row.PaymentStatus === 'PAID') {
        // R-04: PAID bookings are held until EndAt
        if (now.getTime() < endAt.getTime()) {
          canCancel = false;
          reasonIfNot =
            'Đơn đã thanh toán 100% được giữ sân đến hết giờ — chưa thể hủy Khách không đến nhận sân trước giờ kết thúc.';
        }
      } else {
        canCancel = false;
        reasonIfNot = ERROR_CATALOG.NO_SHOW_NOT_ELIGIBLE.defaultMessage;
      }
    }

    const paidAmount = Number(row.PaidAmount);
    const refundCalc = calculateRefund({
      startAt,
      canceledAt: now,
      status: row.Status,
      paymentOption: row.PaymentOption,
      paidAmount,
      depositAmount: Number(row.DepositAmount),
      cancelType,
      settings: {
        refundFullDays,
        refundHalfDays,
        refundHalfRate,
      },
    });

    const daysBeforeStart = Math.round((diffSeconds(startAt, now) / 86_400) * 100) / 100;
    const retainedAmount = paidAmount - (refundCalc.refundAmount ?? 0);

    let policyText: string;
    if (row.Status === 'PENDING_PAYMENT') {
      policyText = 'Đơn chưa thanh toán — hủy miễn phí';
    } else if (cancelType === 'NO_SHOW') {
      policyText = 'Khách không đến nhận sân — không hoàn tiền';
    } else if (refundCalc.refundRate === 100) {
      policyText = `hủy trước từ ${refundFullDays} ngày trở lên`;
    } else if (refundCalc.refundRate !== null && refundCalc.refundRate > 0) {
      policyText = `hủy trước từ ${refundHalfDays} đến dưới ${refundFullDays} ngày`;
    } else {
      policyText = `hủy dưới ${refundHalfDays} ngày`;
    }

    return {
      cancelType,
      canCancel,
      reasonIfNot,
      daysBeforeStart,
      paidAmount,
      depositKept: refundCalc.depositKept,
      refundableBase: refundCalc.refundableBase,
      refundRate: refundCalc.refundRate,
      refundAmount: refundCalc.refundAmount,
      retainedAmount,
      policyText,
    };
  }

  // API-18, UC 009, SDD 3.5e
  async cancelBooking(
    bookingCode: string,
    dto: CancelBookingDto,
    caller: AuthenticatedUser,
  ): Promise<CancelBookingResult> {
    if (dto.cancelType === 'NO_SHOW' && caller.role === 'CUSTOMER') {
      throw new AppError('FORBIDDEN');
    }

    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const [refundFullDays, refundHalfDays, refundHalfRate, noShowGraceMinutes] =
      await Promise.all([
        this.settingsService.getInt('REFUND_FULL_DAYS'),
        this.settingsService.getInt('REFUND_HALF_DAYS'),
        this.settingsService.getInt('REFUND_HALF_RATE'),
        this.settingsService.getInt('NO_SHOW_GRACE_MINUTES'),
      ]);

    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const row = await this.repo.findByCodeForUpdate(tx, bookingCode);
      if (!row) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
      }
      this.bookingState.assertBookingAccess(row, caller);

      if (!row.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (row.Status !== 'PENDING_PAYMENT' && row.Status !== 'CONFIRMED') {
        throw new AppError('BOOKING_NOT_CANCELABLE');
      }

      const startAt = fromSqlDateTime(row.StartAt);
      const endAt = fromSqlDateTime(row.EndAt);

      if (dto.cancelType === 'CUSTOMER_REQUEST') {
        if (now.getTime() >= startAt.getTime()) {
          throw new AppError('BOOKING_NOT_CANCELABLE');
        }
      } else {
        // NO_SHOW
        if (row.Status === 'PENDING_PAYMENT') {
          throw new AppError(
            'NO_SHOW_NOT_ELIGIBLE',
            'Đơn chưa xác nhận (Chờ thanh toán), không thể chọn Khách không đến nhận sân.',
          );
        } else if (row.PaymentStatus === 'DEPOSITED') {
          if (now.getTime() < addMinutes(startAt, noShowGraceMinutes).getTime()) {
            throw new AppError(
              'NO_SHOW_NOT_ELIGIBLE',
              `Chưa quá giờ nhận sân quy định (${noShowGraceMinutes} phút) — không thể chọn 'Khách không đến nhận sân'.`,
            );
          }
        } else if (row.PaymentStatus === 'PAID') {
          // R-04: PAID bookings are held until EndAt
          if (now.getTime() < endAt.getTime()) {
            throw new AppError(
              'NO_SHOW_NOT_ELIGIBLE',
              'Đơn đã thanh toán 100% được giữ sân đến hết giờ — chưa thể hủy Khách không đến nhận sân trước giờ kết thúc.',
            );
          }
        } else {
          throw new AppError('NO_SHOW_NOT_ELIGIBLE');
        }
      }

      const refundCalc = calculateRefund({
        startAt,
        canceledAt: now,
        status: row.Status,
        paymentOption: row.PaymentOption,
        paidAmount: Number(row.PaidAmount),
        depositAmount: Number(row.DepositAmount),
        cancelType: dto.cancelType,
        settings: {
          refundFullDays,
          refundHalfDays,
          refundHalfRate,
        },
      });

      const bookingId = Number(row.BookingId);
      await this.bookingState.cancelBookingInTx(tx, row, {
        expectedVersion,
        cancelType: dto.cancelType,
        cancelReason: dto.reason,
        canceledBy: caller.userId,
        canceledAt: now,
        refundRate: refundCalc.refundRate,
        refundAmount: refundCalc.refundAmount,
        historyNote:
          dto.cancelType === 'NO_SHOW'
            ? `Hủy no-show: ${dto.reason}`
            : `Hủy đơn: ${dto.reason}`,
        restorePromoIfUnpaid: row.Status === 'PENDING_PAYMENT',
      });

      await this.paymentsService.cancelPendingRequestsInTx(tx, bookingId);

      let refundSummary: BookingRefundSummaryDto | null = null;
      if ((refundCalc.refundAmount ?? 0) > 0 && refundCalc.refundRate !== null) {
        const refundReason =
          refundCalc.refundRate === 100
            ? `Khách hủy trước giờ chơi từ ${refundFullDays} ngày trở lên – hoàn 100%`
            : `Khách hủy trước giờ chơi từ ${refundHalfDays} ngày trở lên – hoàn ${refundCalc.refundRate}%`;
        const refundId = await this.repo.insertRefund(tx, {
          bookingId,
          amount: refundCalc.refundAmount!,
          rate: refundCalc.refundRate,
          reason: refundReason,
          now,
        });
        refundSummary = {
          refundId,
          amount: refundCalc.refundAmount!,
          rate: refundCalc.refundRate,
          status: 'PENDING',
        };
      }

      if ((caller.role === 'STAFF' || caller.role === 'OWNER') && row.CustomerUserId !== null) {
        const dateStr = formatDateVn(startAt);
        const startStr = formatTimeVn(startAt);
        const endStr = formatTimeVn(endAt);
        const refundNote =
          refundSummary !== null
            ? ` Số tiền hoàn dự kiến: ${refundSummary.amount.toLocaleString('vi-VN')}đ.`
            : '';
        await this.notificationsService.createNotificationInTx(tx, {
          userId: Number(row.CustomerUserId),
          type: 'SCHEDULE_CHANGE',
          title: 'Lịch đặt sân đã bị hủy',
          body: `Đơn ${row.BookingCode} (${row.CourtName}, ${startStr}–${endStr} ngày ${dateStr}) đã bị hủy. Lý do: ${dto.reason}.${refundNote}`,
          linkType: 'BOOKING',
          linkRef: String(bookingId),
          bookingCode: row.BookingCode,
          promotionCode: null,
        });
      }

      const updatedRow = await this.repo.findByCode(tx, bookingCode);
      if (!updatedRow) {
        throw new AppError('INTERNAL_ERROR');
      }

      const summary = toBookingSummaryDto(updatedRow, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      });

      const bookingRooms = [`booking:${summary.bookingCode}`, `branch:${summary.branchId}`];
      if (summary.customerUserId !== null) {
        bookingRooms.push(`user:${summary.customerUserId}`);
      }

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
        rooms: [`availability:${summary.branchId}:${summary.date}`, `branch:${summary.branchId}`],
        event: 'slot.updated',
        payload: {
          branchId: summary.branchId,
          courtId: summary.courtId,
          date: summary.date,
          startTime: summary.startTime,
          endTime: summary.endTime,
          state: 'FREE',
        },
      });

      return {
        booking: summary,
        refund: refundSummary,
      };
    });
  }

  // Job expireHolds (SDD 2.8, UC 004-4a, 005-2a)
  async expireHolds(limit = 200): Promise<number> {
    const now = this.clock.now();
    const exec = await this.txService.executor();
    const codes = await this.repo.findExpiredPendingBookingCodes(exec, now, limit);

    let expiredCount = 0;

    for (const code of codes) {
      try {
        const didExpire = await this.txService.withTransaction(async (tx) => {
          const row = await this.repo.findByCodeForUpdate(tx, code);
          if (!row || row.Status !== 'PENDING_PAYMENT' || row.HoldExpireAt === null) {
            return false;
          }
          if (fromSqlDateTime(row.HoldExpireAt).getTime() >= now.getTime()) {
            return false;
          }

          const bookingId = Number(row.BookingId);
          const newRowVer = await this.bookingState.expireBookingInTx(tx, row, now);
          if (!newRowVer) {
            return false;
          }

          await this.paymentsService.expirePendingRequestsInTx(tx, bookingId);

          const startAt = fromSqlDateTime(row.StartAt);
          const endAt = fromSqlDateTime(row.EndAt);
          const date = formatDateVn(startAt);
          const startTime = formatTimeVn(startAt);
          const endTime = formatTimeVn(endAt);
          const branchId = Number(row.BranchId);

          tx.events.push({
            rooms: [`availability:${branchId}:${date}`, `branch:${branchId}`],
            event: 'slot.updated',
            payload: {
              branchId,
              courtId: Number(row.CourtId),
              date,
              startTime,
              endTime,
              state: 'FREE',
            },
          });

          const bookingRooms = [`booking:${row.BookingCode}`, `branch:${branchId}`];
          if (row.CustomerUserId !== null) {
            bookingRooms.push(`user:${Number(row.CustomerUserId)}`);
          }

          tx.events.push({
            rooms: bookingRooms,
            event: 'booking.updated',
            payload: {
              bookingCode: row.BookingCode,
              status: 'EXPIRED',
              paymentStatus: row.PaymentStatus,
              paidAmount: Number(row.PaidAmount),
              remainingAmount: Number(row.RemainingAmount),
              isOverdue: false,
              version: encodeRowVer(newRowVer),
            },
          });

          return true;
        });

        if (didExpire) {
          expiredCount += 1;
        }
      } catch (err) {
        this.logger?.error('expireHolds item failed', {
          context: 'BookingsService',
          bookingCode: code,
          error: err,
        });
      }
    }

    return expiredCount;
  }
}
