/**
 * Tác vụ nền — SDD mục 2.8. Chạy đầu mỗi request và định kỳ (MOCK_CONFIG.jobsIntervalMs).
 * Mọi job đều idempotent (lọc theo trạng thái).
 */
import { MOCK_CONFIG } from './config';
import { db } from './db/store';
import { remainingOf } from './lib/mappers';
import { addHistory, cancelBooking, complete, emitBooking, emitSlot, notify, touch } from './lib/ops';
import { fmtVnd } from './lib/pricing';
import { findBranch, findCourt } from './lib/schedule';
import { endTimeOf, ms, nowIso, nowMs, timeOf } from './lib/time';
import { publish } from './realtime';

export function runJobs(): boolean {
  const s = db();
  const now = nowMs();
  const nowStr = nowIso();
  const st = MOCK_CONFIG.settings;
  let changed = false;

  for (const b of s.bookings) {
    // expireHolds
    if (b.status === 'PENDING_PAYMENT' && b.holdExpireAt && ms(b.holdExpireAt) < now) {
      if (b.promotionCode) {
        const p = s.promotions.find((x) => x.code === b.promotionCode);
        if (p && p.usedCount > 0) p.usedCount -= 1;
      }
      addHistory(b, 'EXPIRED', b.paymentStatus, null, 'Hết thời hạn giữ chỗ', b.holdExpireAt);
      b.holdExpireAt = null;
      s.paymentRequests
        .filter((r) => r.bookingCode === b.bookingCode && r.status === 'PENDING')
        .forEach((r) => {
          r.status = 'EXPIRED';
          publish('payment_request.expired', [`booking:${b.bookingCode}`], { requestId: r.requestId, bookingCode: b.bookingCode });
        });
      touch(b, nowStr);
      emitBooking(b);
      emitSlot(b, 'FREE');
      changed = true;
      continue;
    }

    // cancelNoShows — đơn đặt cọc: quá StartAt + 30 phút; đơn đã trả 100%: giữ sân đến hết EndAt (mục 3.5e)
    if (b.status === 'CONFIRMED') {
      const deadline =
        b.paymentStatus === 'PAID' ? ms(b.endAt) : ms(b.startAt) + st.NO_SHOW_GRACE_MINUTES * 60_000;
      if (now >= deadline) {
        cancelBooking(b, { cancelType: 'NO_SHOW', reason: 'Khách không đến nhận sân – Quá giờ', by: null });
        changed = true;
        continue;
      }
    }

    // autoComplete
    if (b.status === 'IN_USE' && ms(b.endAt) <= now) {
      complete(b, null, null, b.endAt);
      changed = true;
      continue;
    }

    // sendReminders
    if (
      b.status === 'CONFIRMED' &&
      !b.reminderSentAt &&
      b.customerUserId &&
      ms(b.startAt) > now &&
      ms(b.startAt) <= now + st.REMINDER_BEFORE_MINUTES * 60_000
    ) {
      const court = findCourt(b.courtId);
      const branch = findBranch(b.branchId);
      const remaining = remainingOf(b);
      notify(
        b.customerUserId,
        'REMINDER',
        '⏰ Nhắc lịch chơi sắp bắt đầu',
        `Chỉ còn 1 tiếng nữa là tới giờ chơi của bạn (${timeOf(b.startAt)} - ${endTimeOf(b.startAt, b.endAt)} hôm nay) tại ${court?.name} - ${branch?.name}, ${branch?.address}.` +
          (remaining > 0 ? ` Số tiền còn lại cần thanh toán tại quầy: ${fmtVnd(remaining)} VNĐ.` : ''),
        { bookingCode: b.bookingCode },
      );
      b.reminderSentAt = nowStr;
      changed = true;
    }
  }

  // expireQr
  for (const r of s.paymentRequests) {
    if (r.status === 'PENDING' && ms(r.expiresAt) < now) {
      r.status = 'EXPIRED';
      publish('payment_request.expired', [`booking:${r.bookingCode}`], { requestId: r.requestId, bookingCode: r.bookingCode });
      changed = true;
    }
  }

  // retryPromoNotify / gửi thông báo khuyến mãi PENDING
  for (const p of s.promotions) {
    if (p.notifyStatus === 'PENDING' || p.notifyStatus === 'FAILED') {
      const targets =
        p.audienceType === 'SPECIFIC' ? p.customerIds : s.users.filter((u) => u.role === 'CUSTOMER' && u.status === 'ACTIVE').map((u) => u.userId);
      targets.forEach((uid) =>
        notify(uid, 'PROMOTION', `🎁 Ưu đãi mới: ${p.name}`, `${p.description ?? p.name}. Nhập mã ${p.code} khi đặt sân (hạn đến ${p.endDate.split('-').reverse().join('/')}).`, {
          promotionCode: p.code,
        }),
      );
      p.notifyStatus = 'SENT';
      changed = true;
    }
  }

  return changed;
}
