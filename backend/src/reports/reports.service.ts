import { Injectable } from '@nestjs/common';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { roundVnd } from '../core/money.js';
import {
  addDays,
  formatDateVn,
  parseTimeToMinutes,
  parseVnDateTime,
  vnDayOfWeek,
} from '../core/time.js';
import {
  type ReportOpeningHourRow,
  ReportsRepository,
} from './reports.repository.js';
import type { RevenueReportQuery } from './reports.schemas.js';

export interface ReportAggregateRowDto {
  key: string;
  name: string;
  courtCount: number;
  orders: number;
  completed: number;
  canceled: number;
  expired: number;
  byFacility: number;
  bookedHours: number;
  capacityHours: number;
  occupancyRate: number;
  fromCompleted: number;
  fromUpcoming: number;
  fromCanceled: number;
  grossCollected: number;
  totalRefunded: number;
  netRevenue: number;
  total: number;
  bankTransfer: number;
  cash: number;
}

export interface RevenueReportSummaryDto extends ReportAggregateRowDto {
  completedRate: number;
  canceledRate: number;
  expiredRate: number;
  bankTransferPct: number;
}

export interface RevenueReportDto {
  period: {
    from: string;
    to: string;
  };
  isEmpty: boolean;
  summary: RevenueReportSummaryDto;
  byBranch: ReportAggregateRowDto[];
  byCourt: ReportAggregateRowDto[];
  promotion: {
    orders: number;
    discountTotal: number;
    revenue: number;
  };
}

interface MutableAggregate {
  key: string;
  name: string;
  courtCount: number;
  orders: number;
  completed: number;
  canceled: number;
  expired: number;
  byFacility: number;
  bookedMinutes: number;
  capacityMinutes: number;
  fromCompleted: number;
  fromUpcoming: number;
  fromCanceled: number;
  grossCollected: number;
  totalRefunded: number;
  bankTransfer: number;
  cash: number;
}

function createAggregate(key: string, name: string, courtCount: number): MutableAggregate {
  return {
    key,
    name,
    courtCount,
    orders: 0,
    completed: 0,
    canceled: 0,
    expired: 0,
    byFacility: 0,
    bookedMinutes: 0,
    capacityMinutes: 0,
    fromCompleted: 0,
    fromUpcoming: 0,
    fromCanceled: 0,
    grossCollected: 0,
    totalRefunded: 0,
    bankTransfer: 0,
    cash: 0,
  };
}

function finalizeAggregate(agg: MutableAggregate): ReportAggregateRowDto {
  const netRevenue = agg.grossCollected - agg.totalRefunded;
  const bookedHours = Math.round((agg.bookedMinutes / 60) * 100) / 100;
  const capacityHours = Math.round((agg.capacityMinutes / 60) * 100) / 100;
  const occupancyRate =
    agg.capacityMinutes > 0
      ? Math.min(100, Math.round((agg.bookedMinutes / agg.capacityMinutes) * 100))
      : 0;

  return {
    key: agg.key,
    name: agg.name,
    courtCount: agg.courtCount,
    orders: agg.orders,
    completed: agg.completed,
    canceled: agg.canceled,
    expired: agg.expired,
    byFacility: agg.byFacility,
    bookedHours,
    capacityHours,
    occupancyRate,
    fromCompleted: agg.fromCompleted,
    fromUpcoming: agg.fromUpcoming,
    fromCanceled: agg.fromCanceled,
    grossCollected: agg.grossCollected,
    totalRefunded: agg.totalRefunded,
    netRevenue,
    total: netRevenue,
    bankTransfer: agg.bankTransfer,
    cash: agg.cash,
  };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly txService: DbTransactionService,
  ) {}

  // API-66
  async getRevenueReport(query: RevenueReportQuery): Promise<RevenueReportDto> {
    const fromStart = parseVnDateTime(query.from, '00:00:00');
    const toStart = parseVnDateTime(query.to, '00:00:00');
    const spanDays = Math.round((toStart.getTime() - fromStart.getTime()) / 86_400_000);

    if (spanDays < 0) {
      throw new AppError('INVALID_DATE_RANGE', {
        message: 'Ngày kết thúc phải sau ngày bắt đầu.',
      });
    }
    if (spanDays > 365) {
      throw new AppError('INVALID_DATE_RANGE', {
        message: 'Khoảng thời gian tra cứu tối đa 366 ngày.',
      });
    }

    const branchId =
      query.branchId === undefined || query.branchId === 'all' ? null : query.branchId;
    const courtId =
      query.courtId === undefined || query.courtId === 'all' ? null : query.courtId;
    const nextDayStart = addDays(toStart, 1);

    const exec = await this.txService.executor();
    const [branches, courts, openingHours, holidays, bookings, payments, refunds] =
      await Promise.all([
        this.repo.listBranchesInScope(exec, branchId),
        this.repo.listCourtsInScope(exec, branchId, courtId),
        this.repo.listOpeningHours(exec, branchId),
        this.repo.listHolidaysInRange(exec, branchId, query.from, query.to),
        this.repo.listBookingsInPeriod(exec, { branchId, courtId, fromStart, nextDayStart }),
        this.repo.listPaymentsInPeriod(exec, { branchId, courtId, fromStart, nextDayStart }),
        this.repo.listCanceledRefundsInPeriod(exec, { branchId, courtId, fromStart, nextDayStart }),
      ]);

    const refundedBookingIds = refunds.filter((r) => r.refundAmount > 0).map((r) => r.bookingId);
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

    const openingMap = new Map<string, ReportOpeningHourRow>();
    for (const oh of openingHours) {
      openingMap.set(`${oh.branchId}:${oh.dayOfWeek}`, oh);
    }

    // Compute per-branch daily open minutes across [from, to] (excluding holidays)
    const branchOpenMinutes = new Map<number, number>();
    for (const br of branches) {
      if (br.status !== 'ACTIVE') {
        branchOpenMinutes.set(br.branchId, 0);
        continue;
      }
      const brHolidays = holidays.filter((h) => h.branchId === br.branchId);
      let openMins = 0;
      for (let i = 0; i <= spanDays; i++) {
        const dayDate = formatDateVn(addDays(fromStart, i));
        const isHoliday = brHolidays.some(
          (h) => h.startDate <= dayDate && dayDate <= h.endDate,
        );
        if (isHoliday) {
          continue;
        }
        const dow = vnDayOfWeek(dayDate);
        const oh = openingMap.get(`${br.branchId}:${dow}`);
        if (!oh || oh.isClosed || !oh.openTime || !oh.closeTime) {
          continue;
        }
        openMins += Math.max(0, parseTimeToMinutes(oh.closeTime) - parseTimeToMinutes(oh.openTime));
      }
      branchOpenMinutes.set(br.branchId, openMins);
    }

    const courtAggMap = new Map<number, MutableAggregate>();
    for (const c of courts) {
      const activeCount = c.status === 'ACTIVE' && c.branchStatus === 'ACTIVE' ? 1 : 0;
      const agg = createAggregate(c.code, c.name, activeCount);
      agg.capacityMinutes = activeCount === 1 ? (branchOpenMinutes.get(c.branchId) ?? 0) : 0;
      courtAggMap.set(c.courtId, agg);
    }

    const branchAggMap = new Map<number, MutableAggregate>();
    for (const br of branches) {
      if (courtId !== null && !courts.some((c) => c.branchId === br.branchId)) {
        continue;
      }
      branchAggMap.set(br.branchId, createAggregate(String(br.branchId), br.name, 0));
    }
    for (const c of courts) {
      const brAgg = branchAggMap.get(c.branchId);
      const cAgg = courtAggMap.get(c.courtId);
      if (brAgg && cAgg) {
        brAgg.courtCount += cAgg.courtCount;
        brAgg.capacityMinutes += cAgg.capacityMinutes;
      }
    }

    const summaryAgg = createAggregate('all', 'Tất cả', 0);
    for (const cAgg of courtAggMap.values()) {
      summaryAgg.courtCount += cAgg.courtCount;
      summaryAgg.capacityMinutes += cAgg.capacityMinutes;
    }

    let promoOrders = 0;
    let promoDiscountTotal = 0;
    let promoRevenue = 0;

    const addBookingStats = (target: MutableAggregate, b: (typeof bookings)[number]) => {
      target.orders += 1;
      if (b.status === 'COMPLETED') {
        target.completed += 1;
      } else if (b.status === 'CANCELED') {
        if (b.cancelType === 'BY_FACILITY') {
          target.byFacility += 1;
        } else {
          target.canceled += 1;
        }
      } else if (b.status === 'EXPIRED') {
        target.expired += 1;
      }

      if (b.status === 'CONFIRMED' || b.status === 'IN_USE' || b.status === 'COMPLETED') {
        target.bookedMinutes += Math.max(
          0,
          Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000),
        );
      }
    };

    for (const b of bookings) {
      addBookingStats(summaryAgg, b);
      const brAgg = branchAggMap.get(b.branchId);
      if (brAgg) addBookingStats(brAgg, b);
      const cAgg = courtAggMap.get(b.courtId);
      if (cAgg) addBookingStats(cAgg, b);

      if (
        b.promotionCode !== null &&
        (b.status === 'CONFIRMED' || b.status === 'IN_USE' || b.status === 'COMPLETED')
      ) {
        promoOrders += 1;
        promoDiscountTotal += b.discountAmount;
        promoRevenue += b.paidAmount;
      }
    }

    const addPaymentStats = (target: MutableAggregate, p: (typeof payments)[number]) => {
      target.grossCollected += p.amount;
      if (p.method === 'CASH') {
        target.cash += p.amount;
      } else {
        target.bankTransfer += p.amount;
      }

      if (p.bookingStatus === 'COMPLETED' || p.bookingStatus === 'IN_USE') {
        target.fromCompleted += p.amount;
      } else if (p.bookingStatus === 'CANCELED') {
        target.fromCanceled += p.amount;
      } else {
        target.fromUpcoming += p.amount;
      }
    };

    for (const p of payments) {
      addPaymentStats(summaryAgg, p);
      const brAgg = branchAggMap.get(p.branchId);
      if (brAgg) addPaymentStats(brAgg, p);
      const cAgg = courtAggMap.get(p.courtId);
      if (cAgg) addPaymentStats(cAgg, p);
    }

    const addRefundStats = (
      target: MutableAggregate,
      refundAmount: number,
      bankShare: number,
      cashShare: number,
    ) => {
      target.totalRefunded += refundAmount;
      target.fromCanceled -= refundAmount;
      target.bankTransfer -= bankShare;
      target.cash -= cashShare;
    };

    for (const r of refunds) {
      if (r.refundAmount === 0) {
        continue;
      }
      const totals = methodMap.get(r.bookingId);
      const totalPaid = totals ? totals.bank + totals.cash : 0;
      let cashShare = 0;
      let bankShare = r.refundAmount;
      if (totalPaid > 0 && totals) {
        cashShare = roundVnd((r.refundAmount * totals.cash) / totalPaid);
        bankShare = r.refundAmount - cashShare;
      }

      addRefundStats(summaryAgg, r.refundAmount, bankShare, cashShare);
      const brAgg = branchAggMap.get(r.branchId);
      if (brAgg) addRefundStats(brAgg, r.refundAmount, bankShare, cashShare);
      const cAgg = courtAggMap.get(r.courtId);
      if (cAgg) addRefundStats(cAgg, r.refundAmount, bankShare, cashShare);
    }

    const baseSummary = finalizeAggregate(summaryAgg);
    const rateOf = (count: number, total: number) =>
      total > 0 ? Math.round((count / total) * 1000) / 10 : 0;

    const summary: RevenueReportSummaryDto = {
      ...baseSummary,
      completedRate: rateOf(baseSummary.completed, baseSummary.orders),
      canceledRate: rateOf(baseSummary.canceled, baseSummary.orders),
      expiredRate: rateOf(baseSummary.expired, baseSummary.orders),
      bankTransferPct: rateOf(baseSummary.bankTransfer, baseSummary.grossCollected),
    };

    const byBranch = [...branchAggMap.values()].map(finalizeAggregate);
    const byCourt = courts
      .map((c) => courtAggMap.get(c.courtId))
      .filter((agg): agg is MutableAggregate => agg !== undefined)
      .filter((agg) => agg.courtCount > 0 || agg.orders > 0 || agg.grossCollected > 0 || agg.totalRefunded > 0)
      .map(finalizeAggregate);

    const isEmpty = bookings.length === 0 && payments.length === 0 && refunds.length === 0;

    return {
      period: {
        from: query.from,
        to: query.to,
      },
      isEmpty,
      summary,
      byBranch,
      byCourt,
      promotion: {
        orders: promoOrders,
        discountTotal: promoDiscountTotal,
        revenue: promoRevenue,
      },
    };
  }
}
