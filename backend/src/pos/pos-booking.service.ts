import { Inject, Injectable } from '@nestjs/common';
import type { BookingSummaryDto, ReceiptDto } from '@sporthub/shared/types';
import { BookingStateService } from '../bookings/booking-state.service.js';
import {
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
  buildBookingSlotStarts,
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
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
} from '../pricing/pricing.engine.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { type PosCustomerRecord, PosRepository } from './pos.repository.js';
import type { CreatePosBookingDto, PosAbortDto, PosCashPaymentDto } from './pos.schemas.js';

function formatVnd(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

@Injectable()
export class PosBookingService {
  constructor(
    private readonly repo: PosRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookingState: BookingStateService,
    private readonly pricingRepo: PricingRepository,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

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

      const openMin = parseTimeToMinutes(openingHour.openTime);
      const closeMin = parseTimeToMinutes(openingHour.closeTime);
      if (startMin < openMin || endMin > closeMin) {
        throw new AppError('OUTSIDE_OPENING_HOURS');
      }

      if (startAt.getTime() <= now.getTime()) {
        throw new AppError('BOOKING_IN_PAST');
      }

      const durationMinutes = endMin - startMin;
      if (
        startMin % court.gridBlockMinutes !== 0 ||
        durationMinutes % court.gridBlockMinutes !== 0
      ) {
        throw new AppError('INVALID_TIME_STEP');
      }

      const rules = await this.pricingRepo.findActivePriceRules(court.courtId, now, tx);
      const rental = calculateRentalPrice({
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        now,
        rules,
      });

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

      const bookingCode = await nextCode(tx, 'BK', toDateKey(now));
      const initialStatus = isZeroTotal ? 'CONFIRMED' : 'PENDING_PAYMENT';
      const initialPaymentStatus = isZeroTotal ? 'PAID' : 'UNPAID';
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

      const slotStarts = buildBookingSlotStarts(startAt, endAt, court.gridBlockMinutes);
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

      const newRowVer = await this.bookingState.cancelBookingInTx(tx, booking, {
        expectedVersion,
        cancelType: 'COUNTER_ABORT',
        cancelReason,
        canceledBy: caller.userId,
        canceledAt: now,
        refundRate: null,
        refundAmount: null,
        historyNote: cancelReason,
        restorePromoIfUnpaid: true,
      });

      await this.paymentsService.cancelPendingRequestsInTx(tx, bookingId);

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
          remainingAmount: Number(booking.RemainingAmount),
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
}
