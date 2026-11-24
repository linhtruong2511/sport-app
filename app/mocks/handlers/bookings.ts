/** API-11 → 20 — đặt sân trực tuyến, thanh toán, lịch đặt của tôi, hủy đơn */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import type { Booking, Channel, PaymentOption, Purpose, User } from '../db/types';
import { ApiError, E } from '../lib/errors';
import { assertBranchAccess, created, idempotent, ok, paginate, route } from '../lib/http';
import { bookingDetail, bookingSummary, paymentRequestView, remainingOf } from '../lib/mappers';
import { assertVersion, cancelBooking, createBooking, createPaymentRequest, simulateTransfer } from '../lib/ops';
import { calcPriceLines, depositFor, evalPromo, priceHint, refundPreview, tryPrice } from '../lib/pricing';
import {
  activeBlockNow,
  assertBookable,
  blocksOverlapping,
  branchDay,
  liveBookingsOverlapping,
  mustBooking,
  mustBranch,
  mustCourt,
  mustSport,
  slotsFor,
} from '../lib/schedule';
import { at, dateOf, diffDays, dow, isDate, ms, nowIso, nowMs, toMin, today } from '../lib/time';

const A = MOCK_CONFIG.apiBase;

/* ------------------------------------------------------------- shared */

/** Quyền xem/thao tác một đơn — SDD API-14 */
export function assertBookingAccess(user: User, b: Booking) {
  if (user.role === 'CUSTOMER' && b.customerUserId !== user.userId) throw E.bookingForbidden();
  if (user.role === 'STAFF') assertBranchAccess(user, b.branchId);
}

export interface QuoteInput {
  courtId?: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  promotionCode?: string | null;
  paymentOption?: PaymentOption;
  channel?: Channel;
  customerPhone?: string | null;
}

/** API-12 — dùng chung cho MH.04 và MH.07 */
export function buildQuote(input: QuoteInput, viewer: User | null) {
  if (!input.courtId) throw E.field('courtId', 'Vui lòng chọn sân.');
  if (!isDate(input.date)) throw E.field('date', 'Ngày không hợp lệ.');
  if (!input.startTime || !input.endTime) throw E.field('startTime', 'Vui lòng chọn khung giờ.');
  const court = mustCourt(Number(input.courtId));
  const branch = mustBranch(court.branchId);
  const channel = input.channel === 'COUNTER' && viewer && viewer.role !== 'CUSTOMER' ? 'COUNTER' : 'ONLINE';

  let slotAvailable = true;
  let priceLines;
  try {
    priceLines = assertBookable({ court, date: input.date, startTime: input.startTime, endTime: input.endTime }).priceLines;
  } catch (e) {
    if (e instanceof ApiError && ['SLOT_TAKEN', 'COURT_UNAVAILABLE', 'BOOKING_IN_PAST'].includes(e.code)) {
      slotAvailable = false;
      priceLines = calcPriceLines(court, input.date, input.startTime, input.endTime);
    } else throw e;
  }
  const baseAmount = priceLines.reduce((s, l) => s + l.amount, 0);

  let customerUserId: number | null = viewer?.role === 'CUSTOMER' ? viewer.userId : null;
  if (channel === 'COUNTER' && input.customerPhone) {
    customerUserId = db().users.find((u) => u.role === 'CUSTOMER' && u.phone === input.customerPhone)?.userId ?? null;
  }
  const code = input.promotionCode?.trim().toUpperCase() || null;
  const promotion = code
    ? evalPromo(
        db().promotions.find((p) => p.code === code),
        code,
        {
          branchId: court.branchId,
          sportId: court.sportId,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          customerUserId,
        },
        baseAmount,
      )
    : null;
  const discountAmount = promotion?.applied ? promotion.discountAmount : 0;
  const totalAmount = baseAmount - discountAmount;
  const depAmount = depositFor(court.depositType, court.depositValue, totalAmount);
  const fullPaymentRequired = totalAmount > 0 && depAmount >= totalAmount;
  const paymentOption: PaymentOption = input.paymentOption === 'DEPOSIT' && !fullPaymentRequired ? 'DEPOSIT' : 'FULL';
  const amountDueNow = paymentOption === 'DEPOSIT' ? depAmount : totalAmount;
  return {
    court: { courtId: court.courtId, name: court.name, branchName: branch.name },
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    durationMinutes: toMin(input.endTime) - toMin(input.startTime),
    slotAvailable,
    priceLines: priceLines.map(({ label, startTime, endTime, pricePerHour, amount }) => ({ label, startTime, endTime, pricePerHour, amount })),
    baseAmount,
    promotion,
    discountAmount,
    totalAmount,
    deposit: { type: court.depositType, value: court.depositValue, amount: depAmount, fullPaymentRequired },
    paymentOption,
    amountDueNow,
    remainingOnArrival: totalAmount - amountDueNow,
  };
}

const STATUS_ORDER: Record<string, number> = {
  CONFIRMED: 0,
  IN_USE: 0,
  PENDING_PAYMENT: 1,
  COMPLETED: 2,
  EXPIRED: 3,
  CANCELED: 3,
};

/* ------------------------------------------------------------- handlers */

export const bookingHandlers = [
  // API-11 — lưới lịch trống
  http.get(`${A}/availability`, route((ctx) => {
    const branchId = ctx.qNum('branchId');
    const sportId = ctx.qNum('sportId');
    const date = ctx.q('date');
    if (branchId == null) throw E.field('branchId', 'Vui lòng chọn chi nhánh.');
    if (sportId == null) throw E.field('sportId', 'Vui lòng chọn bộ môn.');
    if (!isDate(date)) throw E.field('date', 'Ngày không hợp lệ.');
    if (date < today()) throw E.field('date', 'Không xem được lịch của ngày đã qua.');
    const branch = mustBranch(branchId);
    const sport = mustSport(sportId);
    const day = branchDay(branch, date);
    const slots = slotsFor(branch, sport, date);
    const viewer = ctx.viewer;
    const courts = db().courts.filter((c) => c.branchId === branchId && c.sportId === sportId && c.status === 'ACTIVE');

    const data = courts.map((c) => {
      const nowBlock = activeBlockNow(c.courtId);
      const state = nowBlock ? (nowBlock.blockType === 'DECOMMISSION' ? 'INACTIVE' : 'MAINTENANCE') : 'READY';
      const cells = slots.map((sl) => {
        const st = at(date, sl.start);
        const en = at(date, sl.end);
        const blk = blocksOverlapping(c.courtId, st, en)[0];
        if (blk) return { start: sl.start, end: sl.end, state: 'LOCKED', blockId: blk.blockId, blockType: blk.blockType, reason: blk.reason };
        const bk = liveBookingsOverlapping(c.courtId, st, en);
        if (viewer && bk.some((b) => b.customerUserId === viewer.userId)) return { start: sl.start, end: sl.end, state: 'MINE', label: 'Lịch của bạn' };
        if (bk.some((b) => b.status === 'PENDING_PAYMENT')) return { start: sl.start, end: sl.end, state: 'HELD', label: 'Đang giữ chỗ' };
        if (bk.length) return { start: sl.start, end: sl.end, state: 'BOOKED', label: 'Kín lịch' };
        if (ms(st) < nowMs()) return { start: sl.start, end: sl.end, state: 'PAST', label: 'Đã qua' };
        return { start: sl.start, end: sl.end, state: 'FREE', price: tryPrice(c, date, sl.start, sl.end) };
      });
      return { courtId: c.courtId, code: c.code, name: c.name, state, cells };
    });

    return ok({
      date,
      dayOfWeek: dow(date),
      branch: { branchId: branch.branchId, name: branch.name, openTime: day.openTime, closeTime: day.closeTime, isClosed: day.isClosed },
      holiday: day.holiday,
      sport: { sportId: sport.sportId, code: sport.code, name: sport.name, gridBlockMinutes: sport.gridBlockMinutes },
      slotMinutes: sport.slotMinutes,
      slots: slots.map(({ start, end, priceLabel }) => ({ start, end, priceLabel })),
      priceHint: courts[0] ? priceHint(courts[0]) : '',
      courts: data,
    });
  })),

  // API-12 — báo giá
  http.post(`${A}/bookings/quote`, route(async (ctx) => ok(buildQuote(await ctx.body<QuoteInput>(), ctx.viewer)))),

  // API-13 — tạo đơn trực tuyến
  http.post(`${A}/bookings`, route(async (ctx) => {
    const user = ctx.auth('CUSTOMER');
    return idempotent(ctx, async () => {
      const body = await ctx.body<QuoteInput & { note?: string }>();
      if (!body.courtId) throw E.field('courtId', 'Vui lòng chọn sân.');
      if (body.paymentOption !== 'FULL' && body.paymentOption !== 'DEPOSIT') throw E.field('paymentOption', 'Vui lòng chọn hình thức thanh toán.');
      if (body.note && body.note.length > 500) throw E.field('note', 'Ghi chú tối đa 500 ký tự.');
      const b = createBooking({
        court: mustCourt(Number(body.courtId)),
        date: body.date ?? '',
        startTime: body.startTime ?? '',
        endTime: body.endTime ?? '',
        paymentOption: body.paymentOption,
        promotionCode: body.promotionCode,
        customerUserId: user.userId,
        channel: 'ONLINE',
        createdBy: user.userId,
        note: body.note ?? null,
      });
      const pr = b.status === 'PENDING_PAYMENT' ? createPaymentRequest(b, null, null) : null;
      return created({ booking: bookingSummary(b, user), paymentRequest: pr ? paymentRequestView(pr) : null });
    });
  })),

  // API-14 — chi tiết đơn
  http.get(`${A}/bookings/:bookingCode`, route((ctx) => {
    const user = ctx.auth('AUTH');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    return ok(bookingDetail(b, user));
  })),

  // API-15 — mã QR đang hiệu lực
  http.get(`${A}/bookings/:bookingCode/payment-request`, route((ctx) => {
    const user = ctx.auth('AUTH');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const pr = db().paymentRequests.find((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING');
    if (!pr) throw E.notFound('Đơn chưa có mã QR đang hiệu lực.');
    return ok(paymentRequestView(pr));
  })),

  // API-16 — tạo / tạo lại mã QR
  http.post(`${A}/bookings/:bookingCode/payment-requests`, route(async (ctx) => {
    const user = ctx.auth('CUSTOMER', 'STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    return idempotent(ctx, async () => {
      const { purpose } = await ctx.body<{ purpose?: Purpose | null }>();
      const pr = createPaymentRequest(b, purpose ?? null, user.role === 'CUSTOMER' ? null : user.userId);
      return created(paymentRequestView(pr));
    });
  })),

  // API-17 — kiểm tra lại giao dịch
  http.post(`${A}/payment-requests/:requestId/recheck`, route((ctx) => {
    const user = ctx.auth('CUSTOMER', 'STAFF+');
    const s = db();
    const id = Number(ctx.p('requestId'));
    const pr = s.paymentRequests.find((r) => r.requestId === id);
    if (!pr) throw E.notFound('Không tìm thấy yêu cầu thanh toán.');
    const b = mustBooking(pr.bookingCode);
    assertBookingAccess(user, b);
    const last = s.lastRecheck[id] ?? 0;
    if (nowMs() - last < 5000) throw new ApiError(429, 'TOO_MANY_REQUESTS', 'Vui lòng đợi vài giây trước khi kiểm tra lại.');
    s.lastRecheck[id] = nowMs();

    if (pr.status === 'PENDING' && MOCK_CONFIG.recheckAutoPay) simulateTransfer(b);
    const fresh = s.paymentRequests.find((r) => r.requestId === id)!;
    const message =
      fresh.status === 'PAID'
        ? `Đã nhận giao dịch ${fresh.amount.toLocaleString('vi-VN')} VNĐ đúng số tiền & nội dung.`
        : fresh.status === 'EXPIRED'
          ? 'Mã QR đã hết hạn. Vui lòng tạo lại mã QR.'
          : fresh.status === 'CANCELED'
            ? 'Yêu cầu thanh toán đã bị hủy.'
            : 'Chưa nhận được giao dịch báo có. Vui lòng kiểm tra lại sau ít giây.';
    return ok({
      requestId: fresh.requestId,
      status: fresh.status,
      message,
      booking: {
        bookingCode: b.bookingCode,
        status: b.status,
        paymentStatus: b.paymentStatus,
        paidAmount: b.paidAmount,
        remainingAmount: remainingOf(b),
        version: bookingSummary(b, user).version,
      },
    });
  })),

  // API-18 — hủy đơn
  http.post(`${A}/bookings/:bookingCode/cancel`, route(async (ctx) => {
    const user = ctx.auth('CUSTOMER', 'STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const body = await ctx.body<{ cancelType?: 'CUSTOMER_REQUEST' | 'NO_SHOW'; reason?: string; version?: string }>();
    const cancelType = body.cancelType ?? 'CUSTOMER_REQUEST';
    if (cancelType !== 'CUSTOMER_REQUEST' && cancelType !== 'NO_SHOW') throw E.field('cancelType', 'Loại hủy không hợp lệ.');
    if (cancelType === 'NO_SHOW' && user.role === 'CUSTOMER') throw E.forbidden();
    const reason = (body.reason ?? '').trim();
    if (!reason) throw E.field('reason', 'Vui lòng nhập lý do hủy.');
    if (reason.length > 255) throw E.field('reason', 'Lý do hủy tối đa 255 ký tự.');
    assertVersion(b, body.version);
    const { booking, refund } = cancelBooking(b, { cancelType, reason, by: user.userId });
    return ok({
      booking: bookingSummary(booking, user),
      refund: refund ? { refundId: refund.refundId, amount: refund.amount, rate: refund.rate, status: refund.status } : null,
    });
  })),

  // API-19 — lịch đặt của tôi
  http.get(`${A}/me/bookings`, route((ctx) => {
    const user = ctx.auth('CUSTOMER');
    const from = ctx.q('from') ?? '0000-01-01';
    const to = ctx.q('to') ?? '9999-12-31';
    if ((ctx.q('from') && !isDate(from)) || (ctx.q('to') && !isDate(to)) || from > to) throw E.dateRange();
    if (ctx.q('from') && ctx.q('to') && diffDays(from, to) > 366) throw E.dateRange('Khoảng tra cứu tối đa 366 ngày.');
    const status = ctx.q('status') ?? 'ALL';
    const mine = db()
      .bookings.filter((b) => b.customerUserId === user.userId)
      .filter((b) => dateOf(b.startAt) >= from && dateOf(b.startAt) <= to);
    const statusCounts: Record<string, number> = { ALL: mine.length, PENDING_PAYMENT: 0, CONFIRMED: 0, IN_USE: 0, COMPLETED: 0, EXPIRED: 0, CANCELED: 0 };
    mine.forEach((b) => (statusCounts[b.status] += 1));
    const list = mine
      .filter((b) => status === 'ALL' || b.status === status)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (STATUS_ORDER[a.status] >= 2 ? ms(b.startAt) - ms(a.startAt) : ms(a.startAt) - ms(b.startAt)));
    const { items, meta } = paginate(list, ctx.query);
    return ok(items.map((b) => bookingSummary(b, user)), { meta: { ...meta, statusCounts } });
  })),

  // API-20 — xem trước tiền hoàn
  http.get(`${A}/bookings/:bookingCode/cancel-preview`, route((ctx) => {
    const user = ctx.auth('CUSTOMER', 'STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const cancelType = ctx.q('cancelType') === 'NO_SHOW' ? 'NO_SHOW' : 'CUSTOMER_REQUEST';
    return ok(refundPreview(b, cancelType, nowIso()));
  })),
];
