/**
 * Nghiệp vụ có ghi dữ liệu: tạo đơn, sinh QR, ghi nhận thanh toán, hủy, nhận sân,
 * chuyển sân, khớp giao dịch ngân hàng... — module bookings / payments / pos (SDD 2.6, 2.7).
 * Mỗi thao tác phát sự kiện realtime giống backend thật.
 */
import { MOCK_CONFIG } from '../config';
import { db, nextCode, nextId } from '../db/store';
import type {
  BankTxn,
  Booking,
  BookingStatus,
  CancelType,
  Channel,
  Court,
  Notification,
  NotificationType,
  PayMethod,
  Payment,
  PaymentOption,
  PaymentRequest,
  PaymentStatus,
  Purpose,
  Refund,
  TxnIssue,
} from '../db/types';
import { publish } from '../realtime';
import { ApiError, E } from './errors';
import { remainingOf, versionOf } from './mappers';
import { depositFor, evalPromo, fmtVnd, refundPreview } from './pricing';
import { assertBookable, findBranch, findCourt, findUser, mustBranch } from './schedule';
import { addMinutes, at, compactDate, dateOf, endTimeOf, minIso, ms, nowIso, timeOf } from './time';
import { buildVietQr } from './vietqr';

/* ---------------------------------------------------------------- events */

export function emitSlot(b: Booking, state?: string) {
  const date = dateOf(b.startAt);
  const st =
    state ??
    (b.status === 'PENDING_PAYMENT'
      ? 'HELD'
      : b.status === 'CONFIRMED'
        ? 'BOOKED'
        : b.status === 'IN_USE'
          ? 'IN_USE'
          : 'FREE');
  publish('slot.updated', [`availability:${b.branchId}:${date}`, `branch:${b.branchId}`], {
    branchId: b.branchId,
    courtId: b.courtId,
    date,
    startTime: timeOf(b.startAt),
    endTime: endTimeOf(b.startAt, b.endAt),
    state: st,
    bookingCode: b.bookingCode,
  });
}

const bookingRooms = (b: Booking) => {
  const rooms = [`booking:${b.bookingCode}`, `branch:${b.branchId}`];
  if (b.customerUserId) rooms.push(`user:${b.customerUserId}`);
  return rooms;
};

export function emitBooking(b: Booking) {
  publish('booking.updated', bookingRooms(b), {
    bookingCode: b.bookingCode,
    status: b.status,
    paymentStatus: b.paymentStatus,
    paidAmount: b.paidAmount,
    remainingAmount: remainingOf(b),
    isOverdue: false,
    version: versionOf(b),
  });
}

/* ------------------------------------------------------------ helpers */

export function touch(b: Booking, atIso = nowIso()) {
  b.rowVer += 1;
  b.updatedAt = atIso;
}

export function assertVersion(b: Booking, version: unknown) {
  if (typeof version !== 'string' || !version) throw E.field('version', 'Thiếu version của đơn.');
  if (version !== versionOf(b)) {
    throw E.conflict('BOOKING_STATE_CHANGED', 'Trạng thái đơn đã thay đổi, vui lòng tải lại.');
  }
}

export function addHistory(
  b: Booking,
  toStatus: BookingStatus,
  toPayment: PaymentStatus,
  by: number | null,
  note: string | null,
  atIso = nowIso(),
) {
  b.statusHistory.push({
    fromStatus: b.statusHistory.length ? b.status : null,
    toStatus,
    fromPaymentStatus: b.statusHistory.length ? b.paymentStatus : null,
    toPaymentStatus: toPayment,
    changedBy: by,
    changedAt: atIso,
    note,
  });
  b.status = toStatus;
  b.paymentStatus = toPayment;
}

export function notify(
  userId: number | null,
  type: NotificationType,
  title: string,
  body: string,
  link: { bookingCode?: string; promotionCode?: string } = {},
  atIso = nowIso(),
): Notification | null {
  const u = findUser(userId);
  if (!u || u.role !== 'CUSTOMER') return null;
  const n: Notification = {
    notificationId: nextId('notification'),
    userId: u.userId,
    type,
    title,
    body,
    linkType: link.bookingCode ? 'BOOKING' : link.promotionCode ? 'PROMOTION' : null,
    bookingCode: link.bookingCode ?? null,
    promotionCode: link.promotionCode ?? null,
    isRead: false,
    readAt: null,
    createdAt: atIso,
  };
  db().notifications.push(n);
  const unreadCount = db().notifications.filter((x) => x.userId === u.userId && !x.isRead).length;
  publish('notification.created', [`user:${u.userId}`], {
    notificationId: n.notificationId,
    type: n.type,
    title: n.title,
    body: n.body,
    bookingCode: n.bookingCode,
    promotionCode: n.promotionCode,
    createdAt: n.createdAt,
    unreadCount,
  });
  return n;
}

const bookingLabel = (b: Booking) => {
  const court = findCourt(b.courtId);
  const branch = findBranch(b.branchId);
  return `${court?.name ?? ''} - ${branch?.name ?? ''} (${timeOf(b.startAt)} - ${endTimeOf(b.startAt, b.endAt)} ngày ${dateOf(b.startAt).split('-').reverse().join('/')})`;
};

/* ------------------------------------------------------------ create */

export interface CreateBookingInput {
  court: Court;
  date: string;
  startTime: string;
  endTime: string;
  paymentOption: PaymentOption;
  promotionCode?: string | null;
  customerUserId: number | null;
  guestName?: string | null;
  guestPhone?: string | null;
  channel: Channel;
  createdBy: number | null;
  note?: string | null;
  /** Thời điểm tạo (seed dùng giờ quá khứ) */
  at?: string;
  allowPast?: boolean;
}

export function createBooking(input: CreateBookingInput): Booking {
  const s = db();
  const atIso = input.at ?? nowIso();
  const { court } = input;
  const { startIso, endIso, priceLines } = assertBookable({
    court,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    allowPast: input.allowPast,
  });
  const baseAmount = priceLines.reduce((sum, l) => sum + l.amount, 0);

  let discountAmount = 0;
  let promoCode: string | null = null;
  const code = input.promotionCode?.trim().toUpperCase();
  if (code) {
    const promo = s.promotions.find((p) => p.code === code);
    const r = evalPromo(
      promo,
      code,
      {
        branchId: court.branchId,
        sportId: court.sportId,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        customerUserId: input.customerUserId,
      },
      baseAmount,
    );
    if (!r.applied) {
      if (r.reasonCode === 'PROMO_EXHAUSTED') throw E.conflict('PROMO_EXHAUSTED', 'Mã khuyến mãi vừa hết lượt sử dụng.');
      throw E.rule('PROMO_INVALID', r.message ?? 'Mã khuyến mãi không hợp lệ.', { reasonCode: r.reasonCode });
    }
    promo!.usedCount += 1;
    discountAmount = r.discountAmount;
    promoCode = code;
  }

  const totalAmount = baseAmount - discountAmount;
  const deposit = depositFor(court.depositType, court.depositValue, totalAmount);
  if (input.paymentOption === 'DEPOSIT' && totalAmount > 0 && deposit >= totalAmount) {
    if (code) s.promotions.find((p) => p.code === code)!.usedCount -= 1;
    throw E.rule('DEPOSIT_NOT_ALLOWED', 'Sân này yêu cầu cọc 100% tiền thuê — vui lòng chọn Thanh toán đủ.');
  }
  const depositAmount = input.paymentOption === 'DEPOSIT' ? deposit : 0;
  const amountDueNow = input.paymentOption === 'DEPOSIT' ? depositAmount : totalAmount;

  const b: Booking = {
    bookingId: nextId('booking'),
    bookingCode: nextCode('BK', compactDate(dateOf(atIso))),
    branchId: court.branchId,
    courtId: court.courtId,
    customerUserId: input.customerUserId,
    guestName: input.customerUserId ? null : input.guestName ?? null,
    guestPhone: input.customerUserId ? null : input.guestPhone ?? null,
    startAt: startIso,
    endAt: endIso,
    baseAmount,
    discountAmount,
    totalAmount,
    paymentOption: input.paymentOption,
    depositType: court.depositType,
    depositValue: court.depositValue,
    depositAmount,
    amountDueNow,
    paidAmount: 0,
    status: 'PENDING_PAYMENT',
    paymentStatus: 'UNPAID',
    holdExpireAt: minIso(addMinutes(atIso, MOCK_CONFIG.settings.BOOKING_HOLD_MINUTES), startIso),
    promotionCode: promoCode,
    canceledBy: null,
    canceledAt: null,
    cancelReason: null,
    cancelType: null,
    refundRate: null,
    refundAmount: null,
    reminderSentAt: null,
    note: input.note ?? null,
    createdBy: input.createdBy,
    createdAt: atIso,
    updatedAt: atIso,
    rowVer: 1,
    checkedInAt: null,
    checkedOutAt: null,
    channel: input.channel,
    priceLines,
    statusHistory: [],
    transfers: [],
  };
  addHistory(
    b,
    'PENDING_PAYMENT',
    'UNPAID',
    input.createdBy,
    input.channel === 'ONLINE' ? 'Khách đặt trực tuyến' : 'Nhân viên tạo đơn tại quầy',
    atIso,
  );
  if (totalAmount === 0) {
    addHistory(b, 'CONFIRMED', 'PAID', null, 'Mã khuyến mãi giảm toàn bộ tiền sân', atIso);
    b.holdExpireAt = null;
  }
  s.bookings.push(b);
  emitSlot(b);
  return b;
}

/* ------------------------------------------------------------ payment requests */

export function createPaymentRequest(b: Booking, purposeIn: Purpose | null, by: number | null, atIso = nowIso()): PaymentRequest {
  const s = db();
  if (b.status === 'COMPLETED' || b.status === 'CANCELED' || b.status === 'EXPIRED' || b.status === 'IN_USE') {
    throw E.rule('BOOKING_NOT_PAYABLE', 'Đơn đã hoàn thành, đã hủy hoặc quá hạn — không thể tạo mã QR.');
  }
  if (b.status === 'PENDING_PAYMENT' && b.holdExpireAt && ms(b.holdExpireAt) <= ms(atIso)) {
    throw E.rule('HOLD_EXPIRED', 'Đơn đã hết thời hạn giữ chỗ, không thể tạo mã QR mới.');
  }
  const purpose: Purpose =
    purposeIn ?? (b.status === 'PENDING_PAYMENT' ? (b.paymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL') : 'REMAINING');
  const amount = purpose === 'REMAINING' ? remainingOf(b) : b.amountDueNow;
  if (amount <= 0) throw E.rule('NOTHING_TO_PAY', 'Đơn không còn khoản phải thu.');
  const branch = mustBranch(b.branchId);
  if (!branch.bankBin || !branch.bankAccountNo) {
    throw E.rule('BRANCH_BANK_NOT_CONFIGURED', 'Chi nhánh chưa cấu hình tài khoản nhận tiền.');
  }
  s.paymentRequests
    .filter((p) => p.bookingCode === b.bookingCode && p.status === 'PENDING')
    .forEach((p) => (p.status = 'EXPIRED'));

  const counterExpire = addMinutes(atIso, MOCK_CONFIG.settings.QR_EXPIRE_MINUTES);
  const expiresAt =
    b.status === 'PENDING_PAYMENT' && b.holdExpireAt
      ? b.channel === 'ONLINE'
        ? b.holdExpireAt
        : minIso(counterExpire, b.holdExpireAt)
      : counterExpire;
  const transferContent = `THANHTOAN ${b.bookingCode}`;
  const pr: PaymentRequest = {
    requestId: nextId('paymentRequest') + 3000,
    bookingCode: b.bookingCode,
    purpose,
    amount,
    transferContent,
    qrPayload: buildVietQr(branch.bankBin, branch.bankAccountNo, amount, transferContent),
    expiresAt,
    status: 'PENDING',
    createdBy: by,
    createdAt: atIso,
  };
  s.paymentRequests.push(pr);
  return pr;
}

/* ------------------------------------------------------------ record payment */

export interface RecordPaymentInput {
  purpose?: Purpose;
  method: PayMethod;
  channel: Channel;
  amount: number;
  requestId?: number | null;
  bankTxnId?: number | null;
  collectedBy?: number | null;
  at?: string;
  note?: string;
  /** Nhận sân ngay sau khi thu (tất toán tại quầy) */
  checkIn?: boolean;
  silent?: boolean;
}

export function recordPayment(b: Booking, input: RecordPaymentInput): Payment {
  const s = db();
  const atIso = input.at ?? nowIso();
  const purpose: Purpose =
    input.purpose ?? (b.status === 'PENDING_PAYMENT' ? (b.paymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL') : 'REMAINING');
  const p: Payment = {
    paymentId: nextId('payment'),
    paymentCode: nextCode('PT', compactDate(dateOf(atIso))),
    bookingCode: b.bookingCode,
    purpose,
    method: input.method,
    channel: input.channel,
    amount: input.amount,
    requestId: input.requestId ?? null,
    bankTxnId: input.bankTxnId ?? null,
    collectedBy: input.collectedBy ?? null,
    paidAt: atIso,
  };
  s.payments.push(p);
  b.paidAmount += input.amount;
  const payStatus: PaymentStatus = b.paidAmount >= b.totalAmount ? 'PAID' : b.paidAmount > 0 ? 'DEPOSITED' : 'UNPAID';
  const note =
    input.note ??
    (input.method === 'CASH'
      ? `Thu tiền mặt ${fmtVnd(input.amount)}đ`
      : input.bankTxnId
        ? 'Webhook SEPAY – khớp giao dịch'
        : `Chuyển khoản ${fmtVnd(input.amount)}đ`);
  const nextStatus: BookingStatus = b.status === 'PENDING_PAYMENT' ? 'CONFIRMED' : b.status;
  addHistory(b, nextStatus, payStatus, input.collectedBy ?? null, note, atIso);
  b.holdExpireAt = null;

  s.paymentRequests
    .filter((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING')
    .forEach((r) => (r.status = r.requestId === input.requestId ? 'PAID' : 'CANCELED'));

  if (input.checkIn) {
    addHistory(b, 'IN_USE', b.paymentStatus, input.collectedBy ?? null, 'Khách nhận sân', atIso);
    b.checkedInAt = atIso;
  }
  touch(b, atIso);

  if (!input.silent) {
    publish('booking.paid', bookingRooms(b), {
      bookingCode: b.bookingCode,
      paymentCode: p.paymentCode,
      purpose: p.purpose,
      method: p.method,
      amount: p.amount,
      status: b.status,
      paymentStatus: b.paymentStatus,
    });
    emitBooking(b);
    emitSlot(b);
    notify(
      b.customerUserId,
      'PAYMENT_RESULT',
      '✅ Thanh toán thành công',
      `Đã nhận ${fmtVnd(p.amount)} VNĐ cho đơn ${b.bookingCode} – ${bookingLabel(b)}.` +
        (remainingOf(b) > 0 ? ` Số tiền còn lại cần thanh toán khi nhận sân: ${fmtVnd(remainingOf(b))} VNĐ.` : ''),
      { bookingCode: b.bookingCode },
      atIso,
    );
  }
  return p;
}

/* ------------------------------------------------------------ cancel */

export interface CancelInput {
  cancelType: CancelType;
  reason: string;
  by: number | null;
  at?: string;
  silent?: boolean;
}

export function cancelBooking(b: Booking, input: CancelInput): { booking: Booking; refund: Refund | null } {
  const s = db();
  const atIso = input.at ?? nowIso();
  const preview = refundPreview(b, input.cancelType, atIso);
  if (input.cancelType !== 'BY_FACILITY' && input.cancelType !== 'COUNTER_ABORT' && !preview.canCancel) {
    throw E.rule(
      input.cancelType === 'NO_SHOW' ? 'NO_SHOW_NOT_ELIGIBLE' : 'BOOKING_NOT_CANCELABLE',
      preview.reasonIfNot ?? 'Không thể hủy đơn này.',
    );
  }
  const wasPending = b.status === 'PENDING_PAYMENT';
  if (wasPending && b.promotionCode) {
    const promo = s.promotions.find((p) => p.code === b.promotionCode);
    if (promo && promo.usedCount > 0) promo.usedCount -= 1;
  }
  addHistory(b, 'CANCELED', b.paymentStatus, input.by, input.reason, atIso);
  b.cancelType = input.cancelType;
  b.cancelReason = input.reason;
  b.canceledBy = input.by;
  b.canceledAt = atIso;
  b.refundRate = preview.refundRate;
  b.refundAmount = preview.refundAmount;
  b.holdExpireAt = null;
  s.paymentRequests
    .filter((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING')
    .forEach((r) => (r.status = 'CANCELED'));

  let refund: Refund | null = null;
  if (preview.refundAmount > 0) {
    refund = {
      refundId: nextId('refund'),
      bookingCode: b.bookingCode,
      amount: preview.refundAmount,
      rate: preview.refundRate ?? 100,
      reason: input.cancelType === 'BY_FACILITY' ? 'Cơ sở đóng/ngừng nhận lịch' : input.reason,
      status: 'PENDING',
      processedBy: null,
      processedAt: null,
      note: null,
      createdAt: atIso,
    };
    s.refunds.push(refund);
  }
  touch(b, atIso);
  if (!input.silent) {
    emitBooking(b);
    emitSlot(b, 'FREE');
    const actor = findUser(input.by);
    if (input.cancelType === 'BY_FACILITY' || input.cancelType === 'NO_SHOW' || (actor && actor.role !== 'CUSTOMER')) {
      notify(
        b.customerUserId,
        'SCHEDULE_CHANGE',
        input.cancelType === 'BY_FACILITY' ? '⚠️ Lịch đặt của bạn đã bị đóng do cơ sở' : '❌ Lịch đặt của bạn đã bị hủy',
        `Đơn ${b.bookingCode} – ${bookingLabel(b)} đã bị hủy. Lý do: ${input.reason}.` +
          (preview.refundAmount > 0 ? ` Số tiền hoàn: ${fmtVnd(preview.refundAmount)} VNĐ.` : ''),
        { bookingCode: b.bookingCode },
        atIso,
      );
    }
  }
  return { booking: b, refund };
}

/* ------------------------------------------------------------ check-in / complete */

export function assertCourtFree(b: Booking) {
  const blocking = db().bookings.find((x) => x.courtId === b.courtId && x.status === 'IN_USE' && x.bookingCode !== b.bookingCode);
  if (blocking) {
    throw E.conflict(
      'COURT_IN_USE',
      `Sân đang được sử dụng bởi đơn trước (#${blocking.bookingCode}). Vui lòng chờ khách trước trả sân.`,
      { blockingBookingCode: blocking.bookingCode },
    );
  }
}

export function checkIn(b: Booking, by: number | null, atIso = nowIso()) {
  if (b.status !== 'CONFIRMED') throw E.rule('BOOKING_NOT_CHECKINABLE', 'Chỉ nhận sân cho đơn Đã xác nhận.');
  if (remainingOf(b) > 0) throw E.rule('PAYMENT_INCOMPLETE', 'Vui lòng thu đủ 100% tiền sân trước khi nhận sân.');
  if (dateOf(b.startAt) !== dateOf(atIso)) throw E.rule('NOT_TODAY', 'Chỉ nhận sân trong ngày chơi.');
  assertCourtFree(b);
  addHistory(b, 'IN_USE', b.paymentStatus, by, 'Khách nhận sân', atIso);
  b.checkedInAt = atIso;
  touch(b, atIso);
  emitBooking(b);
  emitSlot(b);
}

export function complete(b: Booking, by: number | null, note: string | null, atIso = nowIso(), silent = false) {
  if (b.status !== 'IN_USE') throw E.rule('BOOKING_NOT_IN_USE', 'Đơn không ở trạng thái Đang sử dụng.');
  addHistory(b, 'COMPLETED', b.paymentStatus, by, note ?? (by ? 'Kết thúc sớm' : 'Tự hoàn thành khi hết giờ'), atIso);
  b.checkedOutAt = atIso;
  touch(b, atIso);
  if (!silent) {
    emitBooking(b);
    emitSlot(b, 'FREE');
  }
}

/* ------------------------------------------------------------ reassign (UC 021) */

export function reassign(
  b: Booking,
  newCourt: Court,
  date: string,
  startTime: string,
  endTime: string,
  by: number,
  note: string | null,
) {
  const oldDuration = ms(b.endAt) - ms(b.startAt);
  const newStart = at(date, startTime);
  const newEnd = at(date, endTime);
  if (ms(newEnd) - ms(newStart) !== oldDuration) {
    throw E.rule('DURATION_MISMATCH', 'Khung giờ mới phải cùng thời lượng với đơn gốc.');
  }
  const oldCourt = findCourt(b.courtId);
  if (!oldCourt || newCourt.branchId !== oldCourt.branchId || newCourt.sportId !== oldCourt.sportId) {
    throw E.rule('INVALID_TARGET_COURT', 'Sân đích phải cùng chi nhánh và cùng bộ môn.');
  }
  try {
    assertBookable({ court: newCourt, date, startTime, endTime, excludeCode: b.bookingCode });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'COURT_UNAVAILABLE') {
      throw E.rule('INVALID_TARGET_COURT', 'Sân đích đang khóa hoặc ngừng hoạt động.');
    }
    if (e instanceof ApiError && e.code === 'PRICE_NOT_CONFIGURED') {
      /* chuyển sân không tính lại tiền → bỏ qua lỗi bảng giá */
    } else throw e;
  }
  const atIso = nowIso();
  const old = { ...b };
  emitSlot(old as Booking, 'FREE');
  b.transfers.push({
    transferId: nextId('transfer') + 50,
    oldCourtId: b.courtId,
    oldStartAt: b.startAt,
    oldEndAt: b.endAt,
    newCourtId: newCourt.courtId,
    newStartAt: newStart,
    newEndAt: newEnd,
    performedBy: by,
    performedAt: atIso,
    note,
  });
  b.courtId = newCourt.courtId;
  b.startAt = newStart;
  b.endAt = newEnd;
  b.reminderSentAt = null;
  b.statusHistory.push({
    fromStatus: b.status,
    toStatus: b.status,
    fromPaymentStatus: b.paymentStatus,
    toPaymentStatus: b.paymentStatus,
    changedBy: by,
    changedAt: atIso,
    note: `Chuyển từ ${oldCourt.name} sang ${newCourt.name}${note ? ` – ${note}` : ''}`,
  });
  touch(b, atIso);
  emitSlot(b);
  emitBooking(b);
  notify(
    b.customerUserId,
    'SCHEDULE_CHANGE',
    '🔁 Lịch đặt của bạn được chuyển sân',
    `Đơn ${b.bookingCode} được chuyển sang ${bookingLabel(b)}. Giá trị đơn và số tiền đã thanh toán giữ nguyên.`,
    { bookingCode: b.bookingCode },
    atIso,
  );
  return b.transfers[b.transfers.length - 1];
}

/* ------------------------------------------------------------ bank transfer (webhook) */

const CODE_RE = /BK\d{10,}/i;

export interface BankInput {
  provider: string;
  providerTxnId: string;
  bankName: string | null;
  accountNo: string;
  amount: number;
  content: string;
  transactionAt: string;
  rawPayload: unknown;
}

/** SDD 2.6b + 5.6 — lưu giao dịch, khớp đơn hoặc chuyển "Cần đối soát" */
export function applyBankTransfer(input: BankInput): { txn: BankTxn; duplicated: boolean } {
  const s = db();
  const dup = s.bankTxns.find((t) => t.provider === input.provider && t.providerTxnId === input.providerTxnId);
  if (dup) return { txn: dup, duplicated: true };

  const txn: BankTxn = {
    bankTxnId: nextId('bankTxn') + 500,
    provider: input.provider,
    providerTxnId: input.providerTxnId,
    bankName: input.bankName,
    accountNo: input.accountNo,
    amount: input.amount,
    content: input.content,
    transactionAt: input.transactionAt,
    receivedAt: nowIso(),
    matchStatus: 'PENDING',
    issue: null,
    expectedAmount: null,
    matchedBookingCode: null,
    resolution: null,
    rawPayload: input.rawPayload,
  };
  s.bankTxns.push(txn);

  const needsReview = (issue: TxnIssue, b?: Booking, expected?: number) => {
    txn.matchStatus = 'NEEDS_REVIEW';
    txn.issue = issue;
    txn.matchedBookingCode = b?.bookingCode ?? null;
    txn.expectedAmount = expected ?? null;
    const branch = s.branches.find((x) => x.bankAccountNo === txn.accountNo);
    publish('reconciliation.created', branch ? [`branch:${branch.branchId}`] : [], {
      bankTxnId: txn.bankTxnId,
      issue,
      amount: txn.amount,
      bookingCode: b?.bookingCode ?? null,
    });
  };

  const m = input.content.replace(/\s+/g, '').match(CODE_RE);
  const b = m ? s.bookings.find((x) => x.bookingCode.toUpperCase() === m[0].toUpperCase()) : undefined;
  if (!b) {
    needsReview('UNKNOWN_CONTENT');
    return { txn, duplicated: false };
  }
  const branch = findBranch(b.branchId);
  if (!branch || branch.bankAccountNo !== input.accountNo) {
    needsReview('ACCOUNT_MISMATCH', b);
    return { txn, duplicated: false };
  }
  const now = ms(nowIso());
  const pending = s.paymentRequests.find((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING');
  if (b.status === 'PENDING_PAYMENT' && b.holdExpireAt && ms(b.holdExpireAt) > now) {
    if (input.amount !== b.amountDueNow) {
      needsReview('WRONG_AMOUNT', b, b.amountDueNow);
      return { txn, duplicated: false };
    }
  } else if (b.status === 'CONFIRMED' && b.paymentStatus === 'DEPOSITED') {
    if (input.amount !== remainingOf(b)) {
      needsReview('WRONG_AMOUNT', b, remainingOf(b));
      return { txn, duplicated: false };
    }
  } else {
    needsReview('LATE_PAYMENT', b, b.amountDueNow);
    return { txn, duplicated: false };
  }
  txn.matchStatus = 'MATCHED';
  txn.matchedBookingCode = b.bookingCode;
  recordPayment(b, {
    method: 'BANK_TRANSFER',
    channel: b.channel === 'COUNTER' || b.status === 'CONFIRMED' ? 'COUNTER' : 'ONLINE',
    amount: input.amount,
    requestId: pending?.requestId ?? null,
    bankTxnId: txn.bankTxnId,
    at: input.transactionAt,
  });
  return { txn, duplicated: false };
}

/** Giả lập SePay chuyển đúng số tiền / nội dung cho một đơn */
export function simulateTransfer(b: Booking, override: { amount?: number; content?: string } = {}) {
  const branch = mustBranch(b.branchId);
  const pending = db().paymentRequests.find((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING');
  const amount = override.amount ?? pending?.amount ?? (b.status === 'PENDING_PAYMENT' ? b.amountDueNow : remainingOf(b));
  const id = String(90000 + Math.floor(Math.random() * 9_999_999));
  const content = override.content ?? `THANHTOAN ${b.bookingCode}`;
  const at = nowIso();
  return applyBankTransfer({
    provider: 'SEPAY',
    providerTxnId: id,
    bankName: branch.bankName,
    accountNo: branch.bankAccountNo ?? '',
    amount,
    content,
    transactionAt: at,
    rawPayload: {
      id: Number(id),
      gateway: branch.bankName,
      transactionDate: at.slice(0, 19).replace('T', ' '),
      accountNumber: branch.bankAccountNo,
      content,
      transferType: 'in',
      transferAmount: amount,
      referenceCode: `MOCK.${id}`,
    },
  });
}
