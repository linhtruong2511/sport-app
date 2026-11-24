/** API-66 → 73 — báo cáo doanh thu, đối soát giao dịch, hoàn tiền */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import type { BankTxn, Booking, Court, User } from '../db/types';
import { E } from '../lib/errors';
import { ok, paginate, route, scopeBranch } from '../lib/http';
import { receiptView, remainingOf } from '../lib/mappers';
import { recordPayment } from '../lib/ops';
import { branchDay, findUser, mustBooking, mustBranch } from '../lib/schedule';
import { dateOf, daysInRange, diffDays, isDate, ms, nowIso, nowMs, toMin } from '../lib/time';

const A = MOCK_CONFIG.apiBase;
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------- báo cáo */

function aggregate(key: string, name: string, courts: Court[], from: string, to: string) {
  const s = db();
  const ids = new Set(courts.map((c) => c.courtId));
  const bookings = s.bookings.filter((b) => ids.has(b.courtId) && dateOf(b.startAt) >= from && dateOf(b.startAt) <= to);
  const byCode = new Map(s.bookings.map((b) => [b.bookingCode, b]));
  const pays = s.payments.filter((p) => {
    const b = byCode.get(p.bookingCode);
    return b && ids.has(b.courtId) && dateOf(p.paidAt) >= from && dateOf(p.paidAt) <= to && b.cancelType !== 'BY_FACILITY';
  });
  const refunded = s.bookings
    .filter((b) => ids.has(b.courtId) && b.status === 'CANCELED' && b.cancelType !== 'BY_FACILITY' && b.canceledAt && dateOf(b.canceledAt) >= from && dateOf(b.canceledAt) <= to)
    .reduce((sum, b) => sum + (b.refundAmount ?? 0), 0);
  const sumBy = (pred: (b: Booking) => boolean) => pays.filter((p) => pred(byCode.get(p.bookingCode)!)).reduce((sum, p) => sum + p.amount, 0);

  const bookedHours = bookings
    .filter((b) => b.status === 'CONFIRMED' || b.status === 'IN_USE' || b.status === 'COMPLETED')
    .reduce((sum, b) => sum + (ms(b.endAt) - ms(b.startAt)) / 3_600_000, 0);
  let capacityHours = 0;
  for (const c of courts.filter((x) => x.status === 'ACTIVE')) {
    const branch = mustBranch(c.branchId);
    for (const d of daysInRange(from, to)) {
      const day = branchDay(branch, d);
      if (!day.isClosed && !day.holiday && day.openTime && day.closeTime) capacityHours += (toMin(day.closeTime) - toMin(day.openTime)) / 60;
    }
  }
  const fromCompleted = sumBy((b) => b.status === 'COMPLETED' || b.status === 'IN_USE');
  const fromUpcoming = sumBy((b) => b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT');
  const fromCanceled = sumBy((b) => b.status === 'CANCELED' || b.status === 'EXPIRED') - refunded;
  const bank = pays.filter((p) => p.method === 'BANK_TRANSFER').reduce((sum, p) => sum + p.amount, 0);
  const cash = pays.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + p.amount, 0);
  return {
    key,
    name,
    courtCount: courts.length,
    orders: bookings.length,
    completed: bookings.filter((b) => b.status === 'COMPLETED').length,
    canceled: bookings.filter((b) => b.status === 'CANCELED' && b.cancelType !== 'BY_FACILITY').length,
    expired: bookings.filter((b) => b.status === 'EXPIRED').length,
    byFacility: bookings.filter((b) => b.cancelType === 'BY_FACILITY').length,
    bookedHours: round1(bookedHours),
    capacityHours: round1(capacityHours),
    occupancyRate: capacityHours ? round1((bookedHours / capacityHours) * 100) : 0,
    fromCompleted,
    fromUpcoming,
    fromCanceled,
    total: fromCompleted + fromUpcoming + fromCanceled,
    bankTransfer: bank - refunded,
    cash,
    _bookings: bookings,
  };
}

/* ------------------------------------------------------------- đối soát */

const branchOfTxn = (t: BankTxn) => db().branches.find((b) => b.bankAccountNo === t.accountNo) ?? null;

function txnView(t: BankTxn) {
  const branch = branchOfTxn(t);
  const b = t.matchedBookingCode ? db().bookings.find((x) => x.bookingCode === t.matchedBookingCode) : undefined;
  const cust = b ? (b.customerUserId ? findUser(b.customerUserId)?.fullName : b.guestName) ?? '' : null;
  return {
    bankTxnId: t.bankTxnId,
    provider: t.provider,
    providerTxnId: t.providerTxnId,
    bankName: t.bankName,
    accountNo: t.accountNo,
    branch: branch ? { branchId: branch.branchId, name: branch.name } : null,
    amount: t.amount,
    content: t.content,
    transactionAt: t.transactionAt,
    matchStatus: t.matchStatus,
    issue: t.issue,
    expectedAmount: t.expectedAmount,
    matchedBooking: b ? { bookingCode: b.bookingCode, status: b.status, customerName: cust } : null,
    resolution: t.resolution
      ? { action: t.resolution.action, note: t.resolution.note, resolvedByName: findUser(t.resolution.resolvedBy)?.fullName ?? null, resolvedAt: t.resolution.resolvedAt }
      : null,
  };
}

function mustTxn(user: User, id: number): BankTxn {
  const t = db().bankTxns.find((x) => x.bankTxnId === id);
  if (!t) throw E.notFound('Không tìm thấy giao dịch.');
  const branch = branchOfTxn(t);
  if (user.role === 'STAFF' && branch?.branchId !== user.branchId) throw E.branchForbidden();
  return t;
}

const dueOf = (b: Booking) => (b.status === 'PENDING_PAYMENT' ? b.amountDueNow : remainingOf(b));
const payable = (b: Booking) =>
  (b.status === 'PENDING_PAYMENT' && !!b.holdExpireAt && ms(b.holdExpireAt) > nowMs()) || (b.status === 'CONFIRMED' && b.paymentStatus === 'DEPOSITED');

/* ------------------------------------------------------------- handlers */

export const financeHandlers = [
  // API-66
  http.get(`${A}/reports/revenue`, route((ctx) => {
    ctx.auth('OWNER');
    const from = ctx.q('from');
    const to = ctx.q('to');
    if (!isDate(from) || !isDate(to) || from > to) throw E.dateRange('Ngày kết thúc phải sau ngày bắt đầu.');
    if (diffDays(from, to) > 366) throw E.dateRange('Khoảng tra cứu tối đa 366 ngày.');
    const branchId = ctx.qNum('branchId');
    const courtId = ctx.qNum('courtId');
    const s = db();
    const courts = s.courts.filter((c) => (branchId == null || c.branchId === branchId) && (courtId == null || c.courtId === courtId));
    const { _bookings, key: _k, name: _n, ...summary } = aggregate('ALL', 'Tổng', courts, from, to);
    const strip = ({ _bookings: _b, ...rest }: ReturnType<typeof aggregate>) => rest;
    const byBranch = s.branches
      .filter((b) => branchId == null || b.branchId === branchId)
      .map((b) => strip(aggregate(String(b.branchId), b.name, courts.filter((c) => c.branchId === b.branchId), from, to)));
    const byCourt = courts.map((c) => strip(aggregate(c.code, c.name, [c], from, to)));
    const promoBookings = _bookings.filter((b) => b.promotionCode && b.status !== 'EXPIRED' && b.cancelType !== 'BY_FACILITY');
    const n = summary.orders || 1;
    return ok({
      period: { from, to },
      isEmpty: summary.orders === 0 && summary.total === 0,
      summary: {
        ...summary,
        completedRate: round1((summary.completed / n) * 100),
        canceledRate: round1((summary.canceled / n) * 100),
        expiredRate: round1((summary.expired / n) * 100),
      },
      byBranch,
      byCourt,
      promotion: {
        orders: promoBookings.length,
        discountTotal: promoBookings.reduce((sum, b) => sum + b.discountAmount, 0),
        revenue: promoBookings.reduce((sum, b) => sum + b.paidAmount - (b.refundAmount ?? 0), 0),
      },
    });
  })),

  // API-67
  http.get(`${A}/reconciliation/transactions`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const branchId = scopeBranch(user, ctx.qNum('branchId'));
    const status = ctx.q('status') ?? 'NEEDS_REVIEW';
    const from = ctx.q('from');
    const to = ctx.q('to');
    const inScope = db().bankTxns.filter((t) => branchId == null || branchOfTxn(t)?.branchId === branchId);
    const list = inScope
      .filter((t) => status === 'ALL' || t.matchStatus === status)
      .filter((t) => (!from || dateOf(t.transactionAt) >= from) && (!to || dateOf(t.transactionAt) <= to))
      .sort((a, b) => ms(b.transactionAt) - ms(a.transactionAt));
    const countByStatus: Record<string, number> = { NEEDS_REVIEW: 0, RESOLVED: 0, IGNORED: 0, MATCHED: 0 };
    inScope.forEach((t) => (countByStatus[t.matchStatus] = (countByStatus[t.matchStatus] ?? 0) + 1));
    const { items, meta } = paginate(list, ctx.query);
    return ok(items.map(txnView), { meta: { ...meta, countByStatus } });
  })),

  // API-68
  http.get(`${A}/reconciliation/transactions/:bankTxnId/candidates`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const t = mustTxn(user, Number(ctx.p('bankTxnId')));
    const branch = branchOfTxn(t);
    const q = (ctx.q('q') ?? '').toLowerCase();
    const s = db();
    const list = s.bookings
      .filter((b) => (!branch || b.branchId === branch.branchId) && payable(b))
      .map((b) => {
        const u = b.customerUserId ? findUser(b.customerUserId) : undefined;
        return { b, name: u?.fullName ?? b.guestName ?? '', phone: u?.phone ?? b.guestPhone ?? '' };
      })
      .filter((x) => !q || x.b.bookingCode.toLowerCase().includes(q) || x.name.toLowerCase().includes(q) || x.phone.includes(q))
      .map(({ b, name }) => ({ bookingCode: b.bookingCode, customerName: name, status: b.status, amountDue: dueOf(b), amountMatches: dueOf(b) === t.amount }))
      .sort((a, b) => Number(b.amountMatches) - Number(a.amountMatches));
    return ok(list);
  })),

  // API-69 → 71
  http.post(`${A}/reconciliation/transactions/:bankTxnId/:action`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const t = mustTxn(user, Number(ctx.p('bankTxnId')));
    const action = ctx.p('action');
    const body = await ctx.body<{ bookingCode?: string; note?: string }>();
    if (t.matchStatus !== 'NEEDS_REVIEW' && t.matchStatus !== 'PENDING') {
      throw E.conflict('TXN_ALREADY_RESOLVED', 'Giao dịch đã được xử lý.');
    }
    const resolution = (a: 'MATCHED' | 'REFUNDED' | 'IGNORED') => ({ action: a, note: body.note?.trim() || null, resolvedBy: user.userId, resolvedAt: nowIso() });

    if (action === 'match') {
      if (!body.bookingCode) throw E.field('bookingCode', 'Vui lòng chọn đơn cần gán.');
      const b = mustBooking(body.bookingCode);
      if (user.role === 'STAFF' && b.branchId !== user.branchId) throw E.branchForbidden();
      if (!payable(b)) throw E.rule('BOOKING_NOT_PAYABLE', `Đơn #${b.bookingCode} không còn ở trạng thái Chờ thanh toán — hãy hoàn tiền lại cho khách.`);
      if (t.amount !== dueOf(b)) throw E.rule('AMOUNT_MISMATCH', 'Số tiền giao dịch khác số tiền cần thu — xử lý bằng “Hoàn lại khách”.', { expectedAmount: dueOf(b) });
      const pending = db().paymentRequests.find((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING');
      const p = recordPayment(b, {
        method: 'BANK_TRANSFER',
        channel: b.channel,
        amount: t.amount,
        requestId: pending?.requestId ?? null,
        bankTxnId: t.bankTxnId,
        note: `Đối soát thủ công${body.note ? `: ${body.note}` : ''}`,
      });
      t.matchStatus = 'RESOLVED';
      t.matchedBookingCode = b.bookingCode;
      t.resolution = resolution('MATCHED');
      return ok({ bankTxnId: t.bankTxnId, matchStatus: t.matchStatus, booking: { bookingCode: b.bookingCode, status: b.status, paymentStatus: b.paymentStatus }, receipt: receiptView(p) });
    }
    if (action === 'refund-to-customer') {
      if (!body.note?.trim()) throw E.field('note', 'Vui lòng nhập thông tin hoàn tiền (STK nhận, mã giao dịch hoàn…).');
      t.matchStatus = 'RESOLVED';
      t.resolution = resolution('REFUNDED');
      return ok({ bankTxnId: t.bankTxnId, matchStatus: t.matchStatus, resolution: txnView(t).resolution });
    }
    if (action === 'ignore') {
      t.matchStatus = 'IGNORED';
      t.resolution = resolution('IGNORED');
      return ok({ bankTxnId: t.bankTxnId, matchStatus: t.matchStatus });
    }
    throw E.notFound();
  })),

  // API-72
  http.get(`${A}/refunds`, route((ctx) => {
    ctx.auth('OWNER');
    const branchId = ctx.qNum('branchId');
    const status = ctx.q('status') ?? 'PENDING';
    const s = db();
    const list = s.refunds
      .filter((r) => status === 'ALL' || r.status === status)
      .map((r) => ({ r, b: s.bookings.find((x) => x.bookingCode === r.bookingCode)! }))
      .filter(({ b }) => b && (branchId == null || b.branchId === branchId))
      .sort((x, y) => ms(y.r.createdAt) - ms(x.r.createdAt))
      .map(({ r, b }) => {
        const u = b.customerUserId ? findUser(b.customerUserId) : undefined;
        return {
          refundId: r.refundId,
          bookingCode: r.bookingCode,
          branchName: mustBranch(b.branchId).name,
          customerName: u?.fullName ?? b.guestName ?? '',
          customerPhone: u?.phone ?? b.guestPhone ?? '',
          amount: r.amount,
          rate: r.rate,
          cancelType: b.cancelType,
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
          processedAt: r.processedAt,
          processedByName: findUser(r.processedBy)?.fullName ?? null,
          note: r.note,
        };
      });
    return ok(list);
  })),

  // API-73
  http.post(`${A}/refunds/:refundId/:action`, route(async (ctx) => {
    const user = ctx.auth('OWNER');
    const action = ctx.p('action');
    if (action !== 'complete' && action !== 'fail') throw E.notFound();
    const r = db().refunds.find((x) => x.refundId === Number(ctx.p('refundId')));
    if (!r) throw E.notFound('Không tìm thấy khoản hoàn tiền.');
    if (r.status === 'COMPLETED') throw E.conflict('REFUND_ALREADY_COMPLETED', 'Khoản hoàn đã được xử lý.');
    const { note } = await ctx.body<{ note?: string }>();
    r.status = action === 'complete' ? 'COMPLETED' : 'FAILED';
    r.processedBy = user.userId;
    r.processedAt = nowIso();
    r.note = note?.trim() || r.note;
    return ok({ refundId: r.refundId, status: r.status, processedAt: r.processedAt, processedByName: user.fullName, note: r.note });
  })),
];
