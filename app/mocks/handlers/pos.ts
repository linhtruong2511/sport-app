/** API-25 → 35 — đặt sân tại quầy, thu tiền, tất toán, nhận sân (MH.07, MH.08) */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import type { Booking, PaymentOption, User } from '../db/types';
import { E } from '../lib/errors';
import { created, idempotent, ok, paginate, route, scopeBranch } from '../lib/http';
import { bookingSummary, isOverdue, receiptView, remainingOf } from '../lib/mappers';
import { assertCourtFree, assertVersion, cancelBooking, checkIn, complete, createBooking, recordPayment } from '../lib/ops';
import { activeRules, evalPromo, tryPrice } from '../lib/pricing';
import {
  affectedReasons,
  blocksOverlapping,
  branchDay,
  liveBookingsOverlapping,
  mustBooking,
  mustBranch,
  mustCourt,
  mustSport,
  slotsFor,
} from '../lib/schedule';
import { at, dateOf, fromMin, isDate, ms, nowMs, today, toMin } from '../lib/time';
import { PHONE_RE } from './auth';
import { assertBookingAccess, buildQuote } from './bookings';

const A = MOCK_CONFIG.apiBase;

function requireBranch(user: User, raw: number | null): number {
  const id = scopeBranch(user, raw);
  if (id == null) throw E.field('branchId', 'Vui lòng chọn chi nhánh.');
  mustBranch(id);
  return id;
}

const TAB_ORDER = (b: Booking) =>
  isOverdue(b) ? 0
  : b.status === 'CONFIRMED' ? 1
  : b.status === 'PENDING_PAYMENT' ? 2
  : b.status === 'IN_USE' ? 3
  : b.status === 'COMPLETED' ? 4
  : b.status === 'CANCELED' ? 5
  : 6;

function inTab(b: Booking, tab: string) {
  switch (tab) {
    case 'WAITING': return b.status === 'CONFIRMED' && !isOverdue(b);
    case 'OVERDUE': return isOverdue(b);
    case 'ALL': return true;
    default: return b.status === tab;
  }
}

export const posHandlers = [
  // API-25 — bảng lịch sân tại quầy
  http.get(`${A}/pos/schedule`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const branchId = requireBranch(user, ctx.qNum('branchId'));
    const date = ctx.q('date');
    if (!isDate(date)) throw E.field('date', 'Ngày không hợp lệ.');
    const sportId = ctx.qNum('sportId');
    const branch = mustBranch(branchId);
    const day = branchDay(branch, date);
    const s = db();
    const courts = s.courts.filter((c) => c.branchId === branchId && c.status === 'ACTIVE' && (sportId == null || c.sportId === sportId));

    let topSlots: { start: string; end: string; priceLabel: string | null; isPeak: boolean }[] = [];
    let topMinutes = 60;
    if (sportId != null) {
      const sp = mustSport(sportId);
      topSlots = slotsFor(branch, sp, date);
      topMinutes = sp.slotMinutes;
    } else if (!day.isClosed && !day.holiday && day.openTime && day.closeTime) {
      for (let m = toMin(day.openTime); m + 60 <= toMin(day.closeTime); m += 60) {
        topSlots.push({ start: fromMin(m), end: fromMin(m + 60), priceLabel: null, isPeak: m >= 16 * 60 && m < 21 * 60 });
      }
    }

    const data = courts.map((c) => {
      const sp = mustSport(c.sportId);
      const slots = sportId != null ? topSlots : slotsFor(branch, sp, date);
      const prices = activeRules(c).map((r) => r.pricePerHour);
      const cells = slots.map((sl) => {
        const st = at(date, sl.start);
        const en = at(date, sl.end);
        const blk = blocksOverlapping(c.courtId, st, en)[0];
        if (blk) return { start: sl.start, end: sl.end, state: 'LOCKED', blockId: blk.blockId, blockType: blk.blockType, reason: blk.reason };
        const b = liveBookingsOverlapping(c.courtId, st, en)[0];
        if (b) {
          const guest = !b.customerUserId;
          const customer = guest ? b.guestName : s.users.find((u) => u.userId === b.customerUserId)?.fullName;
          return {
            start: sl.start,
            end: sl.end,
            state: b.status === 'PENDING_PAYMENT' ? 'PENDING_PAYMENT' : b.status === 'IN_USE' ? 'IN_USE' : 'BOOKED',
            booking: {
              bookingCode: b.bookingCode,
              customerName: customer ?? '',
              isGuest: guest,
              startTime: b.startAt.slice(11, 16),
              endTime: b.endAt.slice(11, 16),
              paymentStatus: b.paymentStatus,
              paidAmount: b.paidAmount,
              totalAmount: b.totalAmount,
              isOverdue: isOverdue(b),
              holdExpireAt: b.holdExpireAt,
            },
          };
        }
        return { start: sl.start, end: sl.end, state: 'FREE', price: tryPrice(c, date, sl.start, sl.end), isPast: ms(st) < nowMs() };
      });
      return {
        courtId: c.courtId,
        code: c.code,
        name: c.name,
        sportId: c.sportId,
        sportName: sp.name,
        slotMinutes: sp.slotMinutes,
        minPricePerHour: prices.length ? Math.min(...prices) : null,
        maxPricePerHour: prices.length ? Math.max(...prices) : null,
        cells,
      };
    });
    return ok({
      date,
      branch: { branchId, name: branch.name, openTime: day.openTime, closeTime: day.closeTime, isClosed: day.isClosed },
      holiday: day.holiday,
      slotMinutes: topMinutes,
      slots: topSlots,
      courts: data,
    });
  })),

  // API-26 — tra cứu khách
  http.get(`${A}/pos/customers`, route((ctx) => {
    ctx.auth('STAFF+');
    const phone = (ctx.q('phone') ?? '').trim();
    if (!PHONE_RE.test(phone)) throw E.field('phone', 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).');
    const u = db().users.find((x) => x.role === 'CUSTOMER' && x.phone === phone);
    return ok({
      found: !!u,
      customer: u ? { userId: u.userId, code: u.code, fullName: u.fullName, phone: u.phone, email: u.email, memberTier: u.memberTier } : null,
    });
  })),

  // API-27 — mã khuyến mãi tại quầy
  http.get(`${A}/pos/promotions`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const branchId = requireBranch(user, ctx.qNum('branchId'));
    const courtId = ctx.qNum('courtId');
    const date = ctx.q('date');
    const startTime = ctx.q('startTime');
    const endTime = ctx.q('endTime');
    const phone = ctx.q('customerPhone');
    const s = db();
    const customerUserId = phone ? s.users.find((u) => u.role === 'CUSTOMER' && u.phone === phone)?.userId ?? null : null;
    const court = courtId != null ? mustCourt(courtId) : null;
    const base = court && date && startTime && endTime ? tryPrice(court, date, startTime, endTime) : null;

    const items = s.promotions
      .filter((p) => p.status === 'ACTIVE' && p.endDate >= today() && (p.allBranches || p.branchIds.includes(branchId)))
      .map((p) => {
        if (!court || !date || !startTime || !endTime || base == null) {
          return { code: p.code, name: p.name, applicable: null, discountAmount: 0, reasonCode: null, message: null };
        }
        const r = evalPromo(p, p.code, { branchId, sportId: court.sportId, date, startTime, endTime, customerUserId }, base);
        return { code: p.code, name: p.name, applicable: r.applied, discountAmount: r.discountAmount, reasonCode: r.reasonCode, message: r.applied ? null : r.message };
      });
    const defaultCode = items.find((i) => i.applicable && s.promotions.find((p) => p.code === i.code && !p.allBranches))?.code ?? null;
    return ok({ defaultCode, items });
  })),

  // API-28 — tạo đơn tại quầy (+ thu tiền mặt)
  http.post(`${A}/pos/bookings`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    return idempotent(ctx, async () => {
      const body = await ctx.body<{
        branchId?: number;
        courtId?: number;
        date?: string;
        startTime?: string;
        endTime?: string;
        customer?: { type?: 'GUEST' | 'MEMBER'; userId?: number | null; phone?: string; fullName?: string };
        promotionCode?: string | null;
        paymentOption?: PaymentOption;
        payment?: { method?: 'CASH'; amount?: number } | null;
        note?: string;
      }>();
      const court = mustCourt(Number(body.courtId));
      const branchId = requireBranch(user, body.branchId ?? court.branchId);
      if (court.branchId !== branchId) throw E.branchForbidden();
      const cust = body.customer ?? {};
      const phone = (cust.phone ?? '').trim();
      const fullName = (cust.fullName ?? '').trim();
      let customerUserId: number | null = null;
      if (cust.type === 'MEMBER') {
        const m = db().users.find((u) => u.userId === cust.userId && u.role === 'CUSTOMER');
        if (!m) throw E.rule('MEMBER_NOT_FOUND', 'Chưa xác định được hội viên — hãy bấm Tra cứu hoặc chuyển sang Khách vãng lai.');
        customerUserId = m.userId;
      } else {
        if (!PHONE_RE.test(phone)) throw E.field('customer.phone', 'Số điện thoại khách không hợp lệ (10 chữ số).');
        if (!fullName) throw E.field('customer.fullName', 'Vui lòng nhập họ và tên khách.');
      }
      if (body.paymentOption !== 'FULL' && body.paymentOption !== 'DEPOSIT') throw E.field('paymentOption', 'Vui lòng chọn hình thức thanh toán.');

      if (body.payment?.method === 'CASH') {
        const q = buildQuote(
          { courtId: court.courtId, date: body.date, startTime: body.startTime, endTime: body.endTime, promotionCode: body.promotionCode, paymentOption: body.paymentOption, channel: 'COUNTER', customerPhone: customerUserId ? db().users.find((u) => u.userId === customerUserId)?.phone : phone },
          user,
        );
        if (q.slotAvailable && body.payment.amount !== q.amountDueNow) {
          throw E.rule('AMOUNT_MISMATCH', 'Số tiền thu khác số tiền cần thu hiện tại, vui lòng tải lại báo giá.', { expectedAmount: q.amountDueNow });
        }
      }

      const b = createBooking({
        court,
        date: body.date ?? '',
        startTime: body.startTime ?? '',
        endTime: body.endTime ?? '',
        paymentOption: body.paymentOption,
        promotionCode: body.promotionCode,
        customerUserId,
        guestName: customerUserId ? null : fullName,
        guestPhone: customerUserId ? null : phone,
        channel: 'COUNTER',
        createdBy: user.userId,
        note: body.note ?? null,
      });
      let receipt = null;
      if (body.payment?.method === 'CASH' && b.status === 'PENDING_PAYMENT') {
        receipt = receiptView(recordPayment(b, { method: 'CASH', channel: 'COUNTER', amount: b.amountDueNow, collectedBy: user.userId }));
      }
      return created({ booking: bookingSummary(b, user), receipt });
    });
  })),

  // API-29 — thu tiền mặt cho đơn đang chờ
  http.post(`${A}/pos/bookings/:bookingCode/payments`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    return idempotent(ctx, async () => {
      const body = await ctx.body<{ method?: string; amount?: number; version?: string }>();
      if (body.method !== 'CASH') throw E.field('method', 'Chỉ hỗ trợ CASH.');
      assertVersion(b, body.version);
      if (b.status !== 'PENDING_PAYMENT') throw E.conflict('BOOKING_STATE_CHANGED', 'Trạng thái đơn đã thay đổi, vui lòng tải lại.');
      if (!b.holdExpireAt || ms(b.holdExpireAt) <= nowMs()) throw E.rule('HOLD_EXPIRED', 'Đơn đã quá hạn giữ chỗ.');
      if (body.amount !== b.amountDueNow) throw E.rule('AMOUNT_MISMATCH', 'Số tiền thu phải bằng đúng số tiền cần thu.', { expectedAmount: b.amountDueNow });
      const p = recordPayment(b, { method: 'CASH', channel: 'COUNTER', amount: b.amountDueNow, collectedBy: user.userId });
      return created({ booking: bookingSummary(b, user), receipt: receiptView(p) });
    });
  })),

  // API-30 — hủy tạo đơn tại quầy
  http.post(`${A}/pos/bookings/:bookingCode/abort`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const body = await ctx.body<{ reason?: string; version?: string }>();
    assertVersion(b, body.version);
    if (b.channel !== 'COUNTER' || b.status !== 'PENDING_PAYMENT' || b.paidAmount > 0) {
      throw E.rule('BOOKING_NOT_CANCELABLE', 'Đơn đã thu tiền hoặc không phải đơn tại quầy.');
    }
    cancelBooking(b, { cancelType: 'COUNTER_ABORT', reason: body.reason?.trim() || 'Khách bỏ đi, chưa thanh toán', by: user.userId });
    return ok({ bookingCode: b.bookingCode, status: b.status, cancelType: b.cancelType });
  })),

  // API-31 — phiếu thu gần nhất
  http.get(`${A}/pos/receipts/latest`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const branchId = requireBranch(user, ctx.qNum('branchId'));
    const s = db();
    const codes = new Set(s.bookings.filter((b) => b.branchId === branchId).map((b) => b.bookingCode));
    const latest = s.payments
      .filter((p) => codes.has(p.bookingCode) && p.channel === 'COUNTER')
      .sort((a, b) => ms(b.paidAt) - ms(a.paidAt))[0];
    return ok(latest ? receiptView(latest) : null);
  })),

  // API-32 — danh sách đơn theo ngày
  http.get(`${A}/pos/bookings`, route((ctx) => {
    const user = ctx.auth('STAFF+');
    const branchId = scopeBranch(user, ctx.qNum('branchId'));
    const date = ctx.q('date') ?? today();
    if (!isDate(date)) throw E.field('date', 'Ngày không hợp lệ.');
    const tab = ctx.q('tab') ?? 'ALL';
    const q = (ctx.q('q') ?? '').replace(/#/g, '').trim().toLowerCase();
    const s = db();
    const dayList = s.bookings
      .filter((b) => (branchId == null || b.branchId === branchId) && dateOf(b.startAt) === date)
      .filter((b) => {
        if (!q) return true;
        const name = b.customerUserId ? s.users.find((u) => u.userId === b.customerUserId)?.fullName ?? '' : b.guestName ?? '';
        const phone = b.customerUserId ? s.users.find((u) => u.userId === b.customerUserId)?.phone ?? '' : b.guestPhone ?? '';
        return b.bookingCode.toLowerCase().includes(q) || name.toLowerCase().includes(q) || phone.includes(q);
      });
    const tabCounts: Record<string, number> = { ALL: dayList.length, WAITING: 0, IN_USE: 0, OVERDUE: 0, PENDING_PAYMENT: 0, COMPLETED: 0, CANCELED: 0, EXPIRED: 0, AFFECTED: 0 };
    for (const b of dayList) for (const t of Object.keys(tabCounts)) if (t !== 'ALL' && t !== 'AFFECTED' && inTab(b, t)) tabCounts[t]++;
    tabCounts.AFFECTED = s.bookings.filter((b) => (branchId == null || b.branchId === branchId) && affectedReasons(b).length).length;
    const list = dayList.filter((b) => inTab(b, tab)).sort((a, b) => TAB_ORDER(a) - TAB_ORDER(b) || ms(a.startAt) - ms(b.startAt));
    const { items, meta } = paginate(list, ctx.query, 50);
    return ok(items.map((b) => bookingSummary(b, user)), { meta: { ...meta, tabCounts } });
  })),

  // API-33 — tất toán & nhận sân
  http.post(`${A}/pos/bookings/:bookingCode/settle`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    return idempotent(ctx, async () => {
      const body = await ctx.body<{ method?: string; amount?: number; checkIn?: boolean; version?: string }>();
      if (body.method !== 'CASH') throw E.field('method', 'Tất toán bằng VietQR: dùng API tạo mã QR với purpose = REMAINING.');
      assertVersion(b, body.version);
      if (b.status !== 'CONFIRMED') throw E.conflict('BOOKING_STATE_CHANGED', 'Trạng thái đơn đã thay đổi, vui lòng tải lại.');
      const remaining = remainingOf(b);
      if (remaining <= 0) throw E.rule('NOTHING_TO_PAY', 'Đơn đã thanh toán đủ — dùng chức năng Nhận sân.');
      if (dateOf(b.startAt) !== today()) throw E.rule('NOT_TODAY', 'Chỉ tất toán trong ngày chơi.');
      const doCheckIn = body.checkIn !== false;
      if (doCheckIn) assertCourtFree(b);
      if (body.amount !== remaining) throw E.rule('AMOUNT_MISMATCH', 'Số tiền thu phải bằng đúng số tiền còn lại.', { expectedAmount: remaining });
      const p = recordPayment(b, { purpose: 'REMAINING', method: 'CASH', channel: 'COUNTER', amount: remaining, collectedBy: user.userId, checkIn: doCheckIn });
      return ok({ booking: bookingSummary(b, user), receipt: receiptView(p) });
    });
  })),

  // API-34 — nhận sân
  http.post(`${A}/pos/bookings/:bookingCode/check-in`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const { version } = await ctx.body<{ version?: string }>();
    assertVersion(b, version);
    checkIn(b, user.userId);
    return ok({ booking: bookingSummary(b, user) });
  })),

  // API-35 — kết thúc lượt chơi
  http.post(`${A}/pos/bookings/:bookingCode/complete`, route(async (ctx) => {
    const user = ctx.auth('STAFF+');
    const b = mustBooking(ctx.p('bookingCode'));
    assertBookingAccess(user, b);
    const { version, note } = await ctx.body<{ version?: string; note?: string }>();
    assertVersion(b, version);
    complete(b, user.userId, note ?? null);
    return ok({ booking: bookingSummary(b, user) });
  })),
];
