import { Inject, Injectable } from '@nestjs/common';
import type { AffectedReason, BlockType, UserRole } from '@sporthub/shared/enums';
import type { BookingRefundSummaryDto, BookingSummaryDto } from '@sporthub/shared/types';
import { BookingStateService } from '../bookings/booking-state.service.js';
import {
  decodeRowVer,
  encodeRowVer,
  toBookingSummaryDto,
} from '../bookings/bookings.mapper.js';
import { BookingsRepository } from '../bookings/bookings.repository.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { type DbExecutor, DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { SettingsService } from '../core/settings.service.js';
import {
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
  minutesToTime,
  parseTimeToMinutes,
  parseVnDateTime,
  toIsoVn,
  vnDayOfWeek,
} from '../core/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  type ActiveCourtBlockRow,
  AffectedBookingsRepository,
  type BranchOpeningRow,
  type HolidaySpanRow,
} from './affected-bookings.repository.js';
import type {
  CloseAffectedBookingDto,
  ReassignBookingDto,
  ReassignOptionsQuery,
} from './affected-bookings.schemas.js';

export interface AffectedReasonItem {
  type: AffectedReason;
  refId: number;
  description: string;
}

export type AffectedBookingItem = BookingSummaryDto & {
  affectedReasons: AffectedReasonItem[];
};

export interface AffectedPreviewContext {
  courtIdFilter?: number | null;
  branchIdFilter?: number | null;
  block?: {
    courtId: number;
    courtName: string;
    blockType: BlockType;
    startAt: Date;
    endAt: Date | null;
    reason: string;
  };
  openingHours?: {
    branchId: number;
    days: Array<{
      dayOfWeek: number;
      openTime: string | null;
      closeTime: string | null;
      isClosed: boolean;
    }>;
  };
  holiday?: {
    branchIds: number[];
    startDate: string;
    endDate: string;
    reason: string;
  };
  inactiveCourtId?: number;
}

@Injectable()
export class AffectedBookingsService {
  constructor(
    private readonly repo: AffectedBookingsRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookingState: BookingStateService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async countAffectedBookings(exec: DbExecutor, branchId: number): Promise<number> {
    const items = await this.computeAffectedRows(exec, {
      branchId,
      callerRole: 'STAFF',
      callerUserId: 0,
    });
    return items.length;
  }

  async listAffectedBookings(params: {
    branchId: number | null;
    caller: AuthenticatedUser;
    preview?: AffectedPreviewContext;
  }): Promise<AffectedBookingItem[]> {
    const exec = await this.txService.executor();
    const resolvedBranchId =
      params.caller.role === 'STAFF'
        ? params.caller.branchId
        : (params.preview?.branchIdFilter ?? params.branchId);

    return this.computeAffectedRows(exec, {
      branchId: resolvedBranchId,
      courtId: params.preview?.courtIdFilter ?? null,
      callerRole: params.caller.role,
      callerUserId: params.caller.userId,
      preview: params.preview,
    });
  }

  async computeAffectedRows(
    exec: DbExecutor,
    params: {
      branchId?: number | null;
      courtId?: number | null;
      callerRole: UserRole;
      callerUserId: number;
      preview?: AffectedPreviewContext;
    },
  ): Promise<AffectedBookingItem[]> {
    const now = this.clock.now();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');

    const [bookings, rawBlocks, rawHolidays, rawHours, courts] = await Promise.all([
      this.repo.listOpenFutureBookings(exec, now, params.branchId, params.courtId),
      this.repo.listUnreleasedBlocks(exec, params.branchId),
      this.repo.listHolidays(exec, params.branchId),
      this.repo.listOpeningHours(exec, params.branchId),
      this.repo.listCourtsStatus(exec, params.branchId),
    ]);

    if (bookings.length === 0) {
      return [];
    }

    const blocks: ActiveCourtBlockRow[] = [...rawBlocks];
    if (params.preview?.block) {
      blocks.push({
        blockId: 0,
        courtId: params.preview.block.courtId,
        courtName: params.preview.block.courtName,
        blockType: params.preview.block.blockType,
        startAt: params.preview.block.startAt,
        endAt: params.preview.block.endAt,
        reason: params.preview.block.reason,
      });
    }

    const holidays: HolidaySpanRow[] = [...rawHolidays];
    if (params.preview?.holiday) {
      for (const bid of params.preview.holiday.branchIds) {
        holidays.push({
          holidayId: 0,
          branchId: bid,
          startDate: params.preview.holiday.startDate,
          endDate: params.preview.holiday.endDate,
          reason: params.preview.holiday.reason,
        });
      }
    }

    const openingMap = new Map<string, BranchOpeningRow>();
    for (const h of rawHours) {
      openingMap.set(`${h.branchId}:${h.dayOfWeek}`, h);
    }
    if (params.preview?.openingHours) {
      for (const d of params.preview.openingHours.days) {
        openingMap.set(`${params.preview.openingHours.branchId}:${d.dayOfWeek}`, {
          branchId: params.preview.openingHours.branchId,
          dayOfWeek: d.dayOfWeek,
          openTime: d.openTime,
          closeTime: d.closeTime,
          isClosed: d.isClosed,
        });
      }
    }

    const courtStatusMap = new Map<number, string>();
    for (const c of courts) {
      courtStatusMap.set(
        c.courtId,
        params.preview?.inactiveCourtId === c.courtId ? 'INACTIVE' : c.status,
      );
    }

    const affected: AffectedBookingItem[] = [];

    for (const b of bookings) {
      const startAt = fromSqlDateTime(b.StartAt);
      const endAt = fromSqlDateTime(b.EndAt);
      const bookingDate = formatDateVn(startAt);
      const dow = vnDayOfWeek(startAt);
      const startMin = parseTimeToMinutes(formatTimeVn(startAt));
      const endMin = parseTimeToMinutes(formatTimeVn(endAt));
      const bCourtId = Number(b.CourtId);
      const bBranchId = Number(b.BranchId);

      const reasons: AffectedReasonItem[] = [];

      if (courtStatusMap.get(bCourtId) === 'INACTIVE') {
        reasons.push({
          type: 'COURT_INACTIVE',
          refId: bCourtId,
          description: `${b.CourtName} đang ngừng hoạt động`,
        });
      }

      for (const blk of blocks) {
        if (blk.courtId !== bCourtId) continue;
        const overlaps =
          blk.startAt.getTime() < endAt.getTime() &&
          (blk.endAt === null || blk.endAt.getTime() > startAt.getTime());
        if (overlaps) {
          const actionLabel =
            blk.blockType === 'DECOMMISSION' ? 'ngừng khai thác' : 'tạm khóa bảo trì';
          reasons.push({
            type: 'COURT_BLOCK',
            refId: blk.blockId,
            description: `${blk.courtName} ${actionLabel}: ${blk.reason}`,
          });
        }
      }

      for (const hol of holidays) {
        if (hol.branchId !== bBranchId) continue;
        if (hol.startDate <= bookingDate && bookingDate <= hol.endDate) {
          reasons.push({
            type: 'HOLIDAY',
            refId: hol.holidayId,
            description: hol.reason ? `Ngày nghỉ lễ: ${hol.reason}` : 'Cơ sở nghỉ lễ',
          });
        }
      }

      const oh = openingMap.get(`${bBranchId}:${dow}`);
      if (!oh || oh.isClosed || !oh.openTime || !oh.closeTime) {
        reasons.push({
          type: 'OPENING_HOURS',
          refId: bBranchId,
          description: 'Cơ sở đóng cửa vào thứ này theo giờ mở cửa hiện tại',
        });
      } else {
        const openMin = parseTimeToMinutes(oh.openTime);
        const closeMin = parseTimeToMinutes(oh.closeTime);
        if (startMin < openMin || endMin > closeMin) {
          reasons.push({
            type: 'OPENING_HOURS',
            refId: bBranchId,
            description: `Ngoài giờ mở cửa hiện tại (${oh.openTime}–${oh.closeTime})`,
          });
        }
      }

      if (reasons.length > 0) {
        const summary = toBookingSummaryDto(b, {
          callerRole: params.callerRole,
          callerUserId: params.callerUserId,
          now,
          noShowGraceMinutes,
          isAffected: true,
        });
        affected.push({
          ...summary,
          affectedReasons: reasons,
        });
      }
    }

    return affected;
  }

  // API-37, UC 021
  async getReassignOptions(
    bookingCode: string,
    query: ReassignOptionsQuery,
    caller: AuthenticatedUser,
  ) {
    const exec = await this.txService.executor();
    const row = await this.bookingState.getBookingForAccess(exec, bookingCode, caller);

    if (row.Status !== 'PENDING_PAYMENT' && row.Status !== 'CONFIRMED') {
      throw new AppError('BOOKING_NOT_AFFECTED', {
        message: 'Chỉ xử lý được đơn Chờ thanh toán hoặc Đã xác nhận.',
      });
    }

    const origStart = fromSqlDateTime(row.StartAt);
    const origEnd = fromSqlDateTime(row.EndAt);
    const durationMinutes = Math.round((origEnd.getTime() - origStart.getTime()) / 60_000);

    const targetDate = query.date ?? formatDateVn(origStart);
    const targetStartTime = query.startTime ?? formatTimeVn(origStart);
    const targetEndTime = query.endTime ?? formatTimeVn(origEnd);

    const branchId = Number(row.BranchId);
    const courtInfo = await this.repo.findCourtInfo(exec, Number(row.CourtId));
    if (!courtInfo) {
      throw new AppError('NOT_FOUND');
    }

    const [hasHoliday, oh] = await Promise.all([
      this.repo.hasHolidayOnDate(exec, branchId, targetDate),
      this.repo.getBranchOpeningForDay(exec, branchId, vnDayOfWeek(targetDate)),
    ]);

    const now = this.clock.now();
    const timeOptions: Array<{ startTime: string; endTime: string }> = [];

    if (!hasHoliday && oh && !oh.isClosed && oh.openTime && oh.closeTime) {
      const openMin = parseTimeToMinutes(oh.openTime);
      const closeMin = parseTimeToMinutes(oh.closeTime);
      const step = courtInfo.gridBlockMinutes;

      for (let m = openMin; m + durationMinutes <= closeMin; m += step) {
        const st = minutesToTime(m);
        const et = minutesToTime(m + durationMinutes);
        const candStart = parseVnDateTime(targetDate, st);
        if (candStart.getTime() > now.getTime()) {
          timeOptions.push({ startTime: st, endTime: et });
        }
      }
    }

    let courts: Array<{ courtId: number; code: string; name: string }> = [];
    if (!hasHoliday && oh && !oh.isClosed && oh.openTime && oh.closeTime) {
      const openMin = parseTimeToMinutes(oh.openTime);
      const closeMin = parseTimeToMinutes(oh.closeTime);
      const selStartMin = parseTimeToMinutes(targetStartTime);
      const selEndMin = parseTimeToMinutes(targetEndTime);
      if (
        selStartMin >= openMin &&
        selEndMin <= closeMin &&
        selEndMin - selStartMin === durationMinutes
      ) {
        const candStart = parseVnDateTime(targetDate, targetStartTime);
        const candEnd = parseVnDateTime(targetDate, targetEndTime);
        const sameOriginalSlot =
          targetDate === formatDateVn(origStart) &&
          targetStartTime === formatTimeVn(origStart) &&
          targetEndTime === formatTimeVn(origEnd);

        courts = await this.repo.findReassignCandidateCourts(exec, {
          branchId,
          sportId: courtInfo.sportId,
          excludeBookingId: Number(row.BookingId),
          excludeCourtId: sameOriginalSlot ? Number(row.CourtId) : null,
          startAt: candStart,
          endAt: candEnd,
        });
      }
    }

    return {
      durationMinutes,
      timeOptions,
      courts,
    };
  }

  // API-38, UC 021
  async reassignBooking(
    bookingCode: string,
    dto: ReassignBookingDto,
    caller: AuthenticatedUser,
  ) {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const now = this.clock.now();
    const newStartAt = parseVnDateTime(dto.date, dto.startTime);
    const newEndAt = parseVnDateTime(dto.date, dto.endTime);

    return this.txService.withTransaction(async (tx) => {
      const row = await this.bookingsRepo.findByCodeForUpdate(tx, bookingCode);
      if (!row) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(row, caller);

      if (!row.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (row.Status !== 'PENDING_PAYMENT' && row.Status !== 'CONFIRMED') {
        throw new AppError('INVALID_STATE_TRANSITION', {
          message: 'Chỉ chuyển sân được cho đơn Chờ thanh toán hoặc Đã xác nhận.',
        });
      }

      const oldStartAt = fromSqlDateTime(row.StartAt);
      const oldEndAt = fromSqlDateTime(row.EndAt);
      const origDuration = Math.round((oldEndAt.getTime() - oldStartAt.getTime()) / 60_000);
      const newDuration = Math.round((newEndAt.getTime() - newStartAt.getTime()) / 60_000);
      if (newDuration !== origDuration) {
        throw new AppError('DURATION_MISMATCH');
      }

      if (newStartAt.getTime() <= now.getTime()) {
        throw new AppError('BOOKING_IN_PAST');
      }

      const oldCourt = await this.repo.findCourtInfo(tx, Number(row.CourtId));
      const newCourt = await this.repo.findCourtInfo(tx, dto.newCourtId);
      if (
        !oldCourt ||
        !newCourt ||
        newCourt.status !== 'ACTIVE' ||
        newCourt.branchId !== Number(row.BranchId) ||
        newCourt.sportId !== oldCourt.sportId
      ) {
        throw new AppError('INVALID_TARGET_COURT');
      }

      const hasHoliday = await this.repo.hasHolidayOnDate(tx, newCourt.branchId, dto.date);
      if (hasHoliday) {
        throw new AppError('INVALID_TARGET_COURT');
      }

      const oh = await this.repo.getBranchOpeningForDay(
        tx,
        newCourt.branchId,
        vnDayOfWeek(dto.date),
      );
      if (!oh || oh.isClosed || !oh.openTime || !oh.closeTime) {
        throw new AppError('INVALID_TARGET_COURT');
      }
      const openMin = parseTimeToMinutes(oh.openTime);
      const closeMin = parseTimeToMinutes(oh.closeTime);
      const newStartMin = parseTimeToMinutes(dto.startTime);
      const newEndMin = parseTimeToMinutes(dto.endTime);
      if (
        newStartMin < openMin ||
        newEndMin > closeMin ||
        newStartMin % newCourt.gridBlockMinutes !== 0 ||
        newDuration % newCourt.gridBlockMinutes !== 0
      ) {
        throw new AppError('INVALID_TARGET_COURT');
      }

      const hasBlock = await this.repo.hasActiveBlockInWindow(
        tx,
        dto.newCourtId,
        newStartAt,
        newEndAt,
      );
      if (hasBlock) {
        throw new AppError('INVALID_TARGET_COURT');
      }

      const bookingId = Number(row.BookingId);
      const note = dto.note?.trim() || null;
      await this.bookingState.reassignScheduleInTx(tx, row, {
        expectedVersion,
        newCourtId: dto.newCourtId,
        newStartAt,
        newEndAt,
        gridBlockMinutes: newCourt.gridBlockMinutes,
        changedBy: caller.userId,
        historyNote: `Chuyển từ ${row.CourtName} sang ${newCourt.name}${note ? `: ${note}` : ''}`,
        now,
      });

      const transferId = await this.repo.insertBookingTransfer(tx, {
        bookingId,
        oldCourtId: Number(row.CourtId),
        oldStartAt,
        oldEndAt,
        newCourtId: dto.newCourtId,
        newStartAt,
        newEndAt,
        performedBy: caller.userId,
        note,
        now,
      });

      if (row.CustomerUserId !== null) {
        await this.notificationsService.createNotificationInTx(tx, {
          userId: Number(row.CustomerUserId),
          type: 'SCHEDULE_CHANGE',
          title: '🔁 Lịch đặt của bạn được chuyển sân',
          body: `Đơn ${row.BookingCode} đã được chuyển từ ${row.CourtName} (${formatTimeVn(oldStartAt)}–${formatTimeVn(oldEndAt)} ngày ${formatDateVn(oldStartAt)}) sang ${newCourt.name} (${dto.startTime}–${dto.endTime} ngày ${dto.date}).${note ? ` Lý do: ${note}` : ''}`,
          linkType: 'BOOKING',
          linkRef: String(bookingId),
          bookingCode: row.BookingCode,
          promotionCode: null,
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

      const oldDate = formatDateVn(oldStartAt);
      const branchId = Number(row.BranchId);
      tx.events.push({
        rooms: [`availability:${branchId}:${oldDate}`, `branch:${branchId}`],
        event: 'slot.updated',
        payload: {
          branchId,
          courtId: Number(row.CourtId),
          date: oldDate,
          startTime: formatTimeVn(oldStartAt),
          endTime: formatTimeVn(oldEndAt),
          state: 'FREE',
        },
      });
      tx.events.push({
        rooms: [`availability:${branchId}:${dto.date}`, `branch:${branchId}`],
        event: 'slot.updated',
        payload: {
          branchId,
          courtId: dto.newCourtId,
          date: dto.date,
          startTime: dto.startTime,
          endTime: dto.endTime,
          state: updatedRow.Status === 'CONFIRMED' ? 'BOOKED' : 'HELD',
        },
      });

      const bookingRooms = [`booking:${summary.bookingCode}`, `branch:${branchId}`];
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

      return {
        booking: {
          ...summary,
          affectedReasons: [] as AffectedReasonItem[],
        },
        transfer: {
          transferId,
          oldCourtName: row.CourtName,
          newCourtName: newCourt.name,
          performedAt: toIsoVn(now),
        },
      };
    });
  }

  // API-39, UC 021
  async closeAffectedBooking(
    bookingCode: string,
    dto: CloseAffectedBookingDto,
    caller: AuthenticatedUser,
  ) {
    const expectedVersion = decodeRowVer(dto.version);
    if (!expectedVersion) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const row = await this.bookingsRepo.findByCodeForUpdate(tx, bookingCode);
      if (!row) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(row, caller);

      if (!row.RowVer.equals(expectedVersion)) {
        throw new AppError('BOOKING_STATE_CHANGED');
      }

      if (row.Status !== 'PENDING_PAYMENT' && row.Status !== 'CONFIRMED') {
        throw new AppError('BOOKING_NOT_CANCELABLE');
      }

      const bookingId = Number(row.BookingId);
      const paidAmount = Number(row.PaidAmount);
      const noteSuffix = dto.note?.trim();
      const cancelReason = noteSuffix ? `Đóng đơn do cơ sở: ${noteSuffix}` : 'Đóng đơn do cơ sở';

      const newRowVer = await this.bookingState.cancelBookingInTx(tx, row, {
        expectedVersion,
        cancelType: 'BY_FACILITY',
        cancelReason,
        canceledBy: caller.userId,
        canceledAt: now,
        refundRate: 100,
        refundAmount: paidAmount,
        historyNote: cancelReason,
        // business-rules.md section 5: BY_FACILITY with no money paid yet -> UsedCount - 1
        restorePromoIfUnpaid: paidAmount === 0,
      });

      await this.paymentsService.cancelPendingRequestsInTx(tx, bookingId);

      let refund: BookingRefundSummaryDto | null = null;
      if (paidAmount > 0) {
        const refundId = await this.bookingsRepo.insertRefund(tx, {
          bookingId,
          amount: paidAmount,
          rate: 100,
          reason: cancelReason,
          now,
        });
        refund = {
          refundId,
          amount: paidAmount,
          rate: 100,
          status: 'PENDING',
        };
      }

      const startAt = fromSqlDateTime(row.StartAt);
      const endAt = fromSqlDateTime(row.EndAt);
      const date = formatDateVn(startAt);
      const startTime = formatTimeVn(startAt);
      const endTime = formatTimeVn(endAt);

      if (row.CustomerUserId !== null) {
        const refundText =
          refund !== null
            ? ` Cơ sở sẽ hoàn 100% số tiền đã đóng (${refund.amount.toLocaleString('vi-VN')}đ).`
            : '';
        await this.notificationsService.createNotificationInTx(tx, {
          userId: Number(row.CustomerUserId),
          type: 'SCHEDULE_CHANGE',
          title: 'Đơn đặt sân đã được cơ sở đóng',
          body: `Đơn ${row.BookingCode} (${row.CourtName}, ${startTime}–${endTime} ngày ${date}) đã được đóng do sự cố vận hành cơ sở.${refundText}`,
          linkType: 'BOOKING',
          linkRef: String(bookingId),
          bookingCode: row.BookingCode,
          promotionCode: null,
        });
      }

      const branchId = Number(row.BranchId);
      const bookingRooms = [`booking:${row.BookingCode}`, `branch:${branchId}`];
      if (row.CustomerUserId !== null) {
        bookingRooms.push(`user:${Number(row.CustomerUserId)}`);
      }

      tx.events.push({
        rooms: bookingRooms,
        event: 'booking.updated',
        payload: {
          bookingCode: row.BookingCode,
          status: 'CANCELED',
          paymentStatus: row.PaymentStatus,
          paidAmount,
          remainingAmount: Number(row.RemainingAmount),
          isOverdue: false,
          version: encodeRowVer(newRowVer),
        },
      });
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

      return {
        bookingCode: row.BookingCode,
        status: 'CANCELED' as const,
        cancelType: 'BY_FACILITY' as const,
        refund,
      };
    });
  }
}
