/** API-36 → 41 — đơn bị ảnh hưởng (UC 021) và dashboard trong ngày (UC 015) */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import type { Booking } from '../db/types';
import { E } from '../lib/errors';
import { ok, route, scopeBranch } from '../lib/http';
import { bookingSummary, isOverdue, withAffected } from '../lib/mappers';
import { assertVersion, cancelBooking, reassign } from '../lib/ops';
import {
  activeBlockNow,
  affectedReasons,
  blockEnd,
  blocksOverlapping,
  branchDay,
  findBranch,
  liveBookingsOverlapping,
  mustBooking,
  mustCourt,
  mustSport,
} from '../lib/schedule';
import { at, dateOf, endTimeOf, fromMin, isDate, ms, nowMs, timeOf, today, toMin } from '../lib/time';
import { assertBookingAccess } from './bookings';

const A = MOCK_CONFIG.apiBase;

export const operationHandlers = [
  // API-36
  http.get(`${A}/affected-bookings`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const branchId = scopeBranch(user, ctx.qNum('branchId'));
    const list = db()
      .bookings.filter((b) => (branchId == null || b.branchId === branchId) && affectedReasons(b).length > 0)
      .sort((a, b) => ms(a.startAt) - ms(b.startAt));
    return ok(list.map((b) => withAffected(b, user)));
  })),

  // API-37
  http.get(`${A}/affected-bookings/:bookingCode/reassign-options`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const date = isDate(ctx.q('date')) ? ctx.q('date')! : dateOf(b.startAt);
    const duration = (ms(b.endAt) - ms(b.startAt)) / 60_000;
    const startTime = ctx.q('startTime') ?? timeOf(b.startAt);
    const endTime = ctx.q('endTime') ?? fromMin(toMin(startTime) + duration);
    const court = mustCourt(b.courtId);
    const sport = mustSport(court.sportId);
    const branch = findBranch(b.branchId)!;
    const day = branchDay(branch, date);
    const timeOptions: { startTime: string; endTime: string }[] = [];
    if (!day.isClosed && !day.holiday && day.openTime && day.closeTime) {
      for (let m = toMin(day.openTime); m + duration <= toMin(day.closeTime); m += sport.gridBlockMinutes) {
        if (ms(at(date, fromMin(m))) < nowMs()) continue;
        timeOptions.push({ startTime: fromMin(m), endTime: fromMin(m + duration) });
      }
    }
    const st = at(date, startTime);
    const en = at(date, endTime);
    const courts = day.isClosed || day.holiday
      ? []
      : db().courts.filter(
          (c) =>
            c.branchId === court.branchId &&
            c.sportId === court.sportId &&
            c.status === 'ACTIVE' &&
            (c.courtId !== court.courtId || date !== dateOf(b.startAt) || startTime !== timeOf(b.startAt)) &&
            !blocksOverlapping(c.courtId, st, en).length &&
            !liveBookingsOverlapping(c.courtId, st, en, b.bookingCode).length,
        );
    return ok({
      durationMinutes: duration,
      timeOptions,
      courts: courts.map((c) => ({ courtId: c.courtId, code: c.code, name: c.name })),
    });
  })),

  // API-38
  http.post(`${A}/affected-bookings/:bookingCode/reassign`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const body = await ctx.body<{ newCourtId?: number; date?: string; startTime?: string; endTime?: string; note?: string; version?: string }>();
    if (!body.newCourtId) throw E.field('newCourtId', 'Vui lòng chọn sân mới.');
    if (!isDate(body.date) || body.date < today()) throw E.field('date', 'Ngày mới không hợp lệ.');
    if (!body.startTime || !body.endTime) throw E.field('startTime', 'Vui lòng chọn khung giờ mới.');
    if (body.note && body.note.length > 255) throw E.field('note', 'Ghi chú tối đa 255 ký tự.');
    assertVersion(b, body.version);
    const t = reassign(b, mustCourt(body.newCourtId), body.date, body.startTime, body.endTime, user.userId, body.note ?? null);
    return ok({
      booking: withAffected(b, user),
      transfer: {
        transferId: t.transferId,
        oldCourtName: mustCourt(t.oldCourtId).name,
        newCourtName: mustCourt(t.newCourtId).name,
        performedAt: t.performedAt,
      },
    });
  })),

  // API-39
  http.post(`${A}/affected-bookings/:bookingCode/close`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const body = await ctx.body<{ note?: string; version?: string }>();
    assertVersion(b, body.version);
    if (b.status !== 'PENDING_PAYMENT' && b.status !== 'CONFIRMED') {
      throw E.rule('BOOKING_NOT_CANCELABLE', 'Chỉ đóng được đơn Chờ thanh toán hoặc Đã xác nhận.');
    }
    const { refund } = cancelBooking(b, {
      cancelType: 'BY_FACILITY',
      reason: `Cơ sở đóng/ngừng nhận lịch${body.note ? ` – ${body.note}` : ''}`,
      by: user.userId,
    });
    return ok({
      bookingCode: b.bookingCode,
      status: b.status,
      cancelType: b.cancelType,
      refund: refund ? { refundId: refund.refundId, amount: refund.amount, rate: refund.rate, status: refund.status } : null,
    });
  })),

  // API-40 — dashboard trong ngày
  http.get(`${A}/dashboard/daily`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const raw = ctx.q('branchId');
    if (user.role === 'STAFF' && raw === 'all') throw E.branchForbidden();
    const branchId = scopeBranch(user, ctx.qNum('branchId'), { strict: true });
    const date = isDate(ctx.q('date')) ? ctx.q('date')! : today();
    const s = db();
    const inBranch = (b: Booking) => branchId == null || b.branchId === branchId;
    const dayBookings = s.bookings.filter((b) => inBranch(b) && dateOf(b.startAt) === date);
    const counted = dayBookings.filter((b) => b.status !== 'CANCELED' && b.status !== 'EXPIRED');
    const courts = s.courts.filter((c) => (branchId == null || c.branchId === branchId) && c.status === 'ACTIVE');
    const playing = courts.filter((c) => s.bookings.some((b) => b.courtId === c.courtId && b.status === 'IN_USE'));
    const maintenance = courts.filter((c) => activeBlockNow(c.courtId));

    // Doanh thu thực thu (3.5f)
    const codesInBranch = new Set(s.bookings.filter(inBranch).map((b) => b.bookingCode));
    const byCode = new Map(s.bookings.map((b) => [b.bookingCode, b]));
    const pays = s.payments.filter((p) => codesInBranch.has(p.bookingCode) && dateOf(p.paidAt) === date && byCode.get(p.bookingCode)?.cancelType !== 'BY_FACILITY');
    const refundsToday = s.bookings
      .filter((b) => inBranch(b) && b.status === 'CANCELED' && b.cancelType !== 'BY_FACILITY' && b.canceledAt && dateOf(b.canceledAt) === date)
      .reduce((sum, b) => sum + (b.refundAmount ?? 0), 0);
    const bank = pays.filter((p) => p.method === 'BANK_TRANSFER').reduce((s2, p) => s2 + p.amount, 0);
    const cash = pays.filter((p) => p.method === 'CASH').reduce((s2, p) => s2 + p.amount, 0);
    const depositKept = s.bookings
      .filter((b) => inBranch(b) && b.status === 'CANCELED' && b.cancelType !== 'BY_FACILITY' && b.canceledAt && dateOf(b.canceledAt) === date && b.paymentOption === 'DEPOSIT')
      .reduce((sum, b) => sum + Math.min(b.paidAmount, b.depositAmount), 0);

    const courtBoard = courts.map((c) => {
      const cur = s.bookings.find((b) => b.courtId === c.courtId && b.status === 'IN_USE');
      const next = s.bookings
        .filter((b) => b.courtId === c.courtId && (b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT') && dateOf(b.startAt) === date && ms(b.endAt) > nowMs())
        .sort((a, b) => ms(a.startAt) - ms(b.startAt))[0];
      const blk = activeBlockNow(c.courtId);
      const custName = (b: Booking) => (b.customerUserId ? s.users.find((u) => u.userId === b.customerUserId)?.fullName : b.guestName) ?? '';
      return {
        courtId: c.courtId,
        name: c.name,
        sportName: mustSport(c.sportId).name,
        state: blk ? 'MAINTENANCE' : cur ? 'PLAYING' : next && isOverdue(next) ? 'OVERDUE' : 'FREE',
        currentBooking: cur ? { bookingCode: cur.bookingCode, customerName: custName(cur), endTime: endTimeOf(cur.startAt, cur.endAt) } : null,
        nextBooking: next ? { bookingCode: next.bookingCode, startTime: timeOf(next.startAt), customerName: custName(next) } : null,
        block: blk ? { reason: blk.reason, endAt: blockEnd(blk) } : null,
      };
    });

    const upcoming = dayBookings
      .filter((b) => b.status === 'CONFIRMED')
      .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || ms(a.startAt) - ms(b.startAt))
      .filter((b, i) => isOverdue(b) || i < 4);

    return ok({
      date,
      branchId: branchId ?? 'all',
      branchName: branchId ? findBranch(branchId)?.name ?? '' : 'Tất cả chi nhánh',
      kpis: {
        totalBookings: counted.length,
        onlineBookings: counted.filter((b) => b.channel === 'ONLINE').length,
        counterBookings: counted.filter((b) => b.channel === 'COUNTER').length,
        playingCourts: playing.length,
        totalCourts: courts.length,
        freeCourts: courts.length - playing.length - maintenance.length,
        maintenanceCourts: maintenance.length,
        waitingPayment: dayBookings.filter((b) => b.status === 'PENDING_PAYMENT').length,
        waitingCheckin: dayBookings.filter((b) => b.status === 'CONFIRMED').length,
      },
      revenue: {
        total: bank + cash - refundsToday,
        bankTransfer: bank - refundsToday,
        cash,
        fullyPaidAmount: pays.filter((p) => byCode.get(p.bookingCode)?.paymentStatus === 'PAID').reduce((sum, p) => sum + p.amount, 0),
        depositCollected: pays.filter((p) => p.purpose === 'DEPOSIT' && byCode.get(p.bookingCode)?.paymentStatus === 'DEPOSITED').reduce((sum, p) => sum + p.amount, 0),
        depositKept,
      },
      courtBoard,
      upcoming: upcoming.map((b) => bookingSummary(b, user)),
    });
  })),

  // API-41
  http.get(`${A}/dashboard/daily/bookings`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    if (user.role === 'STAFF' && ctx.q('branchId') === 'all') throw E.branchForbidden();
    const branchId = scopeBranch(user, ctx.qNum('branchId'), { strict: true });
    const date = isDate(ctx.q('date')) ? ctx.q('date')! : today();
    const kpi = ctx.q('kpi') ?? 'TOTAL';
    const s = db();
    let list = s.bookings.filter((b) => (branchId == null || b.branchId === branchId) && dateOf(b.startAt) === date);
    if (kpi === 'TOTAL') list = list.filter((b) => b.status !== 'CANCELED' && b.status !== 'EXPIRED');
    else if (kpi === 'PLAYING') list = list.filter((b) => b.status === 'IN_USE');
    else if (kpi === 'PENDING') list = list.filter((b) => b.status === 'PENDING_PAYMENT' || b.status === 'CONFIRMED');
    else if (kpi === 'REVENUE') {
      const paidCodes = new Set(s.payments.filter((p) => dateOf(p.paidAt) === date).map((p) => p.bookingCode));
      list = s.bookings.filter((b) => (branchId == null || b.branchId === branchId) && paidCodes.has(b.bookingCode) && b.cancelType !== 'BY_FACILITY');
    } else throw E.field('kpi', 'kpi phải là TOTAL | PLAYING | PENDING | REVENUE');
    return ok(
      list
        .sort((a, b) => ms(a.startAt) - ms(b.startAt))
        .map((b) => ({ ...bookingSummary(b, user), ...(kpi === 'REVENUE' ? { retainedAmount: b.paidAmount - (b.refundAmount ?? 0) } : {}) })),
    );
  })),
];
