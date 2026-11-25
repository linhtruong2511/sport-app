import { Inject, Injectable } from '@nestjs/common';
import type { BookingSummaryDto, ReceiptDto } from '@sporthub/shared/types';
import { BookingStateService } from '../bookings/booking-state.service.js';
import { decodeRowVer, toBookingSummaryDto } from '../bookings/bookings.mapper.js';
import { BookingsRepository } from '../bookings/bookings.repository.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { SettingsService } from '../core/settings.service.js';
import { addMinutes, formatDateVn, formatTimeVn, fromSqlDateTime, toIsoVn } from '../core/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PosRepository } from './pos.repository.js';
import type { PosCheckInDto, PosCompleteDto, PosSettleDto } from './pos.schemas.js';

function formatVnd(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

@Injectable()
export class PosLifecycleService {
  constructor(
    private readonly repo: PosRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookingState: BookingStateService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // R-12 / Q-15: no hard-coded fallback — a missing key means migration 004 was not applied and must surface.
  private getCheckInEarlyMinutes(): Promise<number> {
    return this.settingsService.getInt('CHECKIN_EARLY_MINUTES');
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

    const [noShowGraceMinutes, checkInEarlyMinutes] = await Promise.all([
      this.settingsService.getInt('NO_SHOW_GRACE_MINUTES'),
      this.getCheckInEarlyMinutes(),
    ]);
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
        if (now.getTime() < addMinutes(startAt, -checkInEarlyMinutes).getTime()) {
          throw new AppError(
            'CHECK_IN_TOO_EARLY',
            `Chưa đến thời gian cho phép nhận sân (tối đa trước giờ chơi ${checkInEarlyMinutes} phút).`,
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

        const updatedBookingForCheckIn = {
          ...booking,
          PaymentStatus: paymentRes.nextPaymentStatus,
          PaidAmount: paymentRes.paidAmount,
          RemainingAmount: paymentRes.remainingAmount,
        };
        await this.bookingState.checkInInTx(tx, updatedBookingForCheckIn, {
          expectedVersion: nextVerBuf,
          changedBy: caller.userId,
          now,
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

    const [noShowGraceMinutes, checkInEarlyMinutes] = await Promise.all([
      this.settingsService.getInt('NO_SHOW_GRACE_MINUTES'),
      this.getCheckInEarlyMinutes(),
    ]);
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
        now.getTime() < addMinutes(startAt, -checkInEarlyMinutes).getTime()
      ) {
        throw new AppError(
          'CHECK_IN_TOO_EARLY',
          `Chưa đến thời gian cho phép nhận sân (tối đa trước giờ chơi ${checkInEarlyMinutes} phút).`,
        );
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

      await this.bookingState.checkInInTx(tx, booking, {
        expectedVersion,
        changedBy: caller.userId,
        now,
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

      const noteText = dto.note?.trim() ? `Kết thúc sớm: ${dto.note.trim()}` : 'Kết thúc lượt chơi sớm';
      const { freedSlotStarts } = await this.bookingState.completeBookingInTx(tx, booking, {
        expectedVersion,
        changedBy: caller.userId,
        now,
        historyNote: noteText,
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
