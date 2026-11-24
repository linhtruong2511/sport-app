import { Inject, Injectable } from '@nestjs/common';
import type { BlockType, CourtStatus } from '@sporthub/shared/enums';
import type { BookingSummaryDto } from '@sporthub/shared/types';
import { AffectedBookingsService } from '../affected-bookings/affected-bookings.service.js';
import { toBookingSummaryDto } from '../bookings/bookings.mapper.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { roundVnd } from '../core/money.js';
import { SettingsService } from '../core/settings.service.js';
import {
  addDays,
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
  parseVnDateTime,
  toIsoVn,
} from '../core/time.js';
import {
  type DashboardCourtBlockRow,
  DashboardRepository,
} from './dashboard.repository.js';
import type { DailyBookingsQuery, DailyDashboardQuery } from './dashboard.schemas.js';

export type CourtBoardStatus = 'IN_USE' | 'UPCOMING' | 'FREE' | 'LOCKED';

export interface CourtBoardItemDto {
  courtId: number;
  code: string;
  name: string;
  branchId: number;
  branchName: string;
  courtStatus: CourtStatus;
  status: CourtBoardStatus;
  currentBooking: {
    bookingCode: string;
    customerName: string;
    startTime: string;
    endTime: string;
  } | null;
  nextBooking: {
    bookingCode: string;
    customerName: string;
    startTime: string;
    endTime: string;
  } | null;
  block: {
    blockId: number;
    blockType: BlockType;
    reason: string;
    startAt: string;
    endAt: string | null;
  } | null;
}

export interface DailyDashboardDto {
  date: string;
  branchId: number | null;
  kpis: {
    totalBookings: number;
    onlineBookings: number;
    counterBookings: number;
    playingCount: number;
    pendingCount: number;
    playingCourts: number;
    totalCourts: number;
    freeCourts: number;
    maintenanceCourts: number;
    waitingPayment: number;
    waitingCheckin: number;
    revenue: number;
    affectedCount: number;
  };
  revenue: {
    total: number;
    grossPayments: number;
    refunds: number;
    bankTransfer: number;
    cash: number;
    fullyPaidAmount: number;
    depositCollected: number;
    depositKept: number;
  };
  courtBoard: CourtBoardItemDto[];
  upcoming: BookingSummaryDto[];
}

export type RevenueDrilldownBookingDto = BookingSummaryDto & {
  collectedOnDate: number;
  refundedOnDate: number;
  retainedAmount: number;
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly affectedBookingsService: AffectedBookingsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  resolveBranchScope(
    requestedBranchId: number | 'all' | undefined,
    caller: AuthenticatedUser,
  ): number | null {
    if (caller.role === 'STAFF') {
      if (caller.branchId === null) {
        throw new AppError('BRANCH_FORBIDDEN');
      }
      if (requestedBranchId !== undefined && requestedBranchId !== caller.branchId) {
        throw new AppError('BRANCH_FORBIDDEN');
      }
      return caller.branchId;
    }

    if (caller.role === 'OWNER') {
      if (requestedBranchId === undefined || requestedBranchId === 'all') {
        return null;
      }
      return requestedBranchId;
    }

    throw new AppError('FORBIDDEN');
  }

  // API-40
  async getDailyDashboard(
    query: DailyDashboardQuery,
    caller: AuthenticatedUser,
  ): Promise<DailyDashboardDto> {
    const branchId = this.resolveBranchScope(query.branchId, caller);
    const now = this.clock.now();
    const targetDate = query.date ?? formatDateVn(now);

    const dayStart = parseVnDateTime(targetDate, '00:00:00');
    const nextDayStart = addDays(dayStart, 1);

    const exec = await this.txService.executor();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');

    const [branchIds, dayBookings, dailyPayments, dailyRefunds, courts, blocks] = await Promise.all([
      this.repo.listBranchIdsInScope(exec, branchId),
      this.repo.listDayBookings(exec, { branchId, dayStart, nextDayStart }),
      this.repo.listDailyPayments(exec, { branchId, dayStart, nextDayStart }),
      this.repo.listDailyCanceledRefunds(exec, { branchId, dayStart, nextDayStart }),
      this.repo.listCourtsForBoard(exec, branchId),
      this.repo.listDayCourtBlocks(exec, { branchId, dayStart, nextDayStart }),
    ]);

    const affectedCounts = await Promise.all(
      branchIds.map((bId) => this.affectedBookingsService.countAffectedBookings(exec, bId)),
    );
    const affectedCount = affectedCounts.reduce((sum, n) => sum + n, 0);

    // Revenue calculation (SDD 3.5f + Q-14)
    const refundedBookingIds = dailyRefunds
      .filter((r) => r.refundAmount > 0)
      .map((r) => r.bookingId);
    const methodTotals = await this.repo.getBookingPaymentTotalsByMethod(exec, refundedBookingIds);
    const methodMap = new Map<number, { bank: number; cash: number }>();
    for (const row of methodTotals) {
      const entry = methodMap.get(row.bookingId) ?? { bank: 0, cash: 0 };
      if (row.method === 'CASH') {
        entry.cash += row.totalAmount;
      } else {
        entry.bank += row.totalAmount;
      }
      methodMap.set(row.bookingId, entry);
    }

    let grossPayments = 0;
    let bankTransfer = 0;
    let cash = 0;
    let fullyPaidAmount = 0;
    let depositCollected = 0;

    for (const p of dailyPayments) {
      grossPayments += p.amount;
      if (p.method === 'CASH') {
        cash += p.amount;
      } else {
        bankTransfer += p.amount;
      }
      if (p.bookingStatus !== 'CANCELED') {
        if (p.purpose === 'DEPOSIT') {
          depositCollected += p.amount;
        } else {
          fullyPaidAmount += p.amount;
        }
      }
    }

    let refunds = 0;
    let depositKept = 0;
    for (const r of dailyRefunds) {
      refunds += r.refundAmount;
      if (r.paymentOption === 'DEPOSIT') {
        const kept = Math.max(0, Math.min(r.paidAmount, r.depositAmount) - Math.max(0, r.refundAmount - Math.max(0, r.paidAmount - r.depositAmount)));
        depositKept += kept;
      }
      if (r.refundAmount > 0) {
        const totals = methodMap.get(r.bookingId);
        const totalPaid = totals ? totals.bank + totals.cash : 0;
        if (totalPaid > 0 && totals) {
          const cashShare = roundVnd((r.refundAmount * totals.cash) / totalPaid);
          const bankShare = r.refundAmount - cashShare;
          cash -= cashShare;
          bankTransfer -= bankShare;
        } else {
          bankTransfer -= r.refundAmount;
        }
      }
    }

    const totalRevenue = grossPayments - refunds;

    // KPI counts on play date = targetDate
    const liveBookings = dayBookings.filter(
      (b) =>
        b.Status === 'PENDING_PAYMENT' ||
        b.Status === 'CONFIRMED' ||
        b.Status === 'IN_USE' ||
        b.Status === 'COMPLETED',
    );
    const totalBookings = liveBookings.length;
    const onlineBookings = liveBookings.filter((b) => b.Channel === 'ONLINE').length;
    const counterBookings = liveBookings.filter((b) => b.Channel === 'COUNTER').length;
    const playingBookings = dayBookings.filter((b) => b.Status === 'IN_USE');
    const playingCount = playingBookings.length;
    const waitingPayment = dayBookings.filter((b) => b.Status === 'PENDING_PAYMENT').length;
    const confirmedBookings = dayBookings.filter((b) => b.Status === 'CONFIRMED');
    const waitingCheckin = confirmedBookings.length;
    const pendingCount = dayBookings.filter(
      (b) =>
        b.Status === 'PENDING_PAYMENT' ||
        (b.Status === 'CONFIRMED' && b.PaymentStatus === 'DEPOSITED'),
    ).length;

    // Court board
    const blocksByCourt = new Map<number, DashboardCourtBlockRow[]>();
    for (const blk of blocks) {
      const list = blocksByCourt.get(blk.courtId) ?? [];
      list.push(blk);
      blocksByCourt.set(blk.courtId, list);
    }

    const courtBoard: CourtBoardItemDto[] = courts.map((court) => {
      const courtInUse = playingBookings.find((b) => Number(b.CourtId) === court.courtId) ?? null;
      const courtNext =
        confirmedBookings.find((b) => Number(b.CourtId) === court.courtId) ?? null;
      const courtBlocks = blocksByCourt.get(court.courtId) ?? [];

      const activeBlock =
        courtBlocks.find((blk) => blk.blockType === 'DECOMMISSION') ??
        courtBlocks[0] ??
        null;

      const currentBooking = courtInUse
        ? {
            bookingCode: courtInUse.BookingCode,
            customerName:
              courtInUse.CustomerUserId === null
                ? (courtInUse.GuestName ?? '')
                : (courtInUse.CustomerUserName ?? ''),
            startTime: formatTimeVn(fromSqlDateTime(courtInUse.StartAt)),
            endTime: formatTimeVn(fromSqlDateTime(courtInUse.EndAt)),
          }
        : null;

      const nextBooking = courtNext
        ? {
            bookingCode: courtNext.BookingCode,
            customerName:
              courtNext.CustomerUserId === null
                ? (courtNext.GuestName ?? '')
                : (courtNext.CustomerUserName ?? ''),
            startTime: formatTimeVn(fromSqlDateTime(courtNext.StartAt)),
            endTime: formatTimeVn(fromSqlDateTime(courtNext.EndAt)),
          }
        : null;

      let status: CourtBoardStatus;
      if (court.courtStatus === 'INACTIVE' || activeBlock?.blockType === 'DECOMMISSION') {
        status = 'LOCKED';
      } else if (currentBooking !== null) {
        status = 'IN_USE';
      } else if (activeBlock !== null) {
        status = 'LOCKED';
      } else if (nextBooking !== null) {
        status = 'UPCOMING';
      } else {
        status = 'FREE';
      }

      return {
        courtId: court.courtId,
        code: court.code,
        name: court.name,
        branchId: court.branchId,
        branchName: court.branchName,
        courtStatus: court.courtStatus,
        status,
        currentBooking,
        nextBooking,
        block: activeBlock
          ? {
              blockId: activeBlock.blockId,
              blockType: activeBlock.blockType,
              reason: activeBlock.reason,
              startAt: toIsoVn(activeBlock.startAt),
              endAt: activeBlock.endAt ? toIsoVn(activeBlock.endAt) : null,
            }
          : null,
      };
    });

    const totalCourts = courtBoard.length;
    const playingCourts = courtBoard.filter((c) => c.status === 'IN_USE').length;
    const maintenanceCourts = courtBoard.filter((c) => c.status === 'LOCKED').length;
    const freeCourts = totalCourts - playingCourts - maintenanceCourts;

    const upcoming = confirmedBookings.slice(0, 4).map((row) =>
      toBookingSummaryDto(row, {
        callerRole: caller.role,
        callerUserId: caller.userId,
        now,
        noShowGraceMinutes,
      }),
    );

    return {
      date: targetDate,
      branchId,
      kpis: {
        totalBookings,
        onlineBookings,
        counterBookings,
        playingCount,
        pendingCount,
        playingCourts,
        totalCourts,
        freeCourts,
        maintenanceCourts,
        waitingPayment,
        waitingCheckin,
        revenue: totalRevenue,
        affectedCount,
      },
      revenue: {
        total: totalRevenue,
        grossPayments,
        refunds,
        bankTransfer,
        cash,
        fullyPaidAmount,
        depositCollected,
        depositKept,
      },
      courtBoard,
      upcoming,
    };
  }

  // API-41
  async getDailyBookings(
    query: DailyBookingsQuery,
    caller: AuthenticatedUser,
  ): Promise<Array<BookingSummaryDto | RevenueDrilldownBookingDto>> {
    const branchId = this.resolveBranchScope(query.branchId, caller);
    const now = this.clock.now();
    const targetDate = query.date ?? formatDateVn(now);
    const dayStart = parseVnDateTime(targetDate, '00:00:00');
    const nextDayStart = addDays(dayStart, 1);

    const exec = await this.txService.executor();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');
    const dtoCtx = {
      callerRole: caller.role,
      callerUserId: caller.userId,
      now,
      noShowGraceMinutes,
    };

    if (query.kpi === 'REVENUE') {
      const rows = await this.repo.listRevenueDrilldownBookings(exec, {
        branchId,
        dayStart,
        nextDayStart,
      });
      return rows.map((row) => {
        const collectedOnDate = Number(row.CollectedOnDate);
        const refundedOnDate = Number(row.RefundedOnDate);
        return {
          ...toBookingSummaryDto(row, dtoCtx),
          collectedOnDate,
          refundedOnDate,
          retainedAmount: collectedOnDate - refundedOnDate,
        };
      });
    }

    const dayBookings = await this.repo.listDayBookings(exec, { branchId, dayStart, nextDayStart });

    const filtered = dayBookings.filter((b) => {
      switch (query.kpi) {
        case 'TOTAL':
          return (
            b.Status === 'PENDING_PAYMENT' ||
            b.Status === 'CONFIRMED' ||
            b.Status === 'IN_USE' ||
            b.Status === 'COMPLETED'
          );
        case 'PLAYING':
          return b.Status === 'IN_USE';
        case 'PENDING':
          return (
            b.Status === 'PENDING_PAYMENT' ||
            (b.Status === 'CONFIRMED' && b.PaymentStatus === 'DEPOSITED')
          );
      }
    });

    return filtered.map((row) => toBookingSummaryDto(row, dtoCtx));
  }
}
