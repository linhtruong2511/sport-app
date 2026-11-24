/**
 * Giờ mở cửa, ngày nghỉ, khóa sân, kiểm tra đặt được hay không — module availability (SDD 2.3, 2.5).
 */
import { db } from '../db/store';
import type { Booking, BookingStatus, Branch, Court, CourtBlock, Holiday, Sport } from '../db/types';
import { E } from './errors';
import { calcPriceLines, ruleLabelAt } from './pricing';
import { at, dateOf, dow, fromMin, isDate, isTime, ms, nowMs, overlaps, toMin } from './time';

export const LIVE_STATUSES: BookingStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'IN_USE'];

export const findBranch = (id: number) => db().branches.find((b) => b.branchId === id);
export const findSport = (id: number) => db().sports.find((s) => s.sportId === id);
export const findCourt = (id: number) => db().courts.find((c) => c.courtId === id);
export const findUser = (id: number | null | undefined) =>
  id == null ? undefined : db().users.find((u) => u.userId === id);
export const findBooking = (code: string) =>
  db().bookings.find((b) => b.bookingCode.toUpperCase() === code.toUpperCase());

export const mustBranch = (id: number): Branch => {
  const b = findBranch(id);
  if (!b) throw E.notFound('Không tìm thấy chi nhánh.');
  return b;
};
export const mustSport = (id: number): Sport => {
  const s = findSport(id);
  if (!s) throw E.notFound('Không tìm thấy bộ môn.');
  return s;
};
export const mustCourt = (id: number): Court => {
  const c = findCourt(id);
  if (!c) throw E.notFound('Không tìm thấy sân.');
  return c;
};
export const mustBooking = (code: string): Booking => {
  const b = findBooking(code);
  if (!b) throw E.notFound('Không tìm thấy đơn đặt sân');
  return b;
};

export function holidayOf(branchId: number, date: string): Holiday | null {
  return db().holidays.find((h) => h.branchId === branchId && h.startDate <= date && date <= h.endDate) ?? null;
}

export function branchDay(branch: Branch, date: string) {
  const oh = branch.openingHours.find((o) => o.dayOfWeek === dow(date));
  const holiday = holidayOf(branch.branchId, date);
  return {
    openTime: oh?.openTime ?? null,
    closeTime: oh?.closeTime ?? null,
    isClosed: !oh || oh.isClosed || !oh.openTime || !oh.closeTime,
    holiday: holiday
      ? { holidayId: holiday.holidayId, startDate: holiday.startDate, endDate: holiday.endDate, reason: holiday.reason }
      : null,
  };
}

/** Khoảng khóa thực tế: [StartAt, min(ReleasedAt, EndAt)) */
export const blockEnd = (b: CourtBlock): string | null => {
  if (b.releasedAt && b.endAt) return ms(b.releasedAt) < ms(b.endAt) ? b.releasedAt : b.endAt;
  return b.releasedAt ?? b.endAt;
};

export function blocksOverlapping(courtId: number, startIso: string, endIso: string): CourtBlock[] {
  return db().blocks.filter((b) => b.courtId === courtId && overlaps(startIso, endIso, b.startAt, blockEnd(b)));
}

/** Khóa đang hiệu lực tại thời điểm hiện tại hoặc trong tương lai */
export function currentBlocks(courtId?: number): CourtBlock[] {
  const now = nowMs();
  return db().blocks.filter((b) => {
    if (courtId != null && b.courtId !== courtId) return false;
    const end = blockEnd(b);
    if (b.releasedAt && ms(b.releasedAt) <= now) return false;
    return end == null || ms(end) > now;
  });
}

export function activeBlockNow(courtId: number): CourtBlock | null {
  const now = nowMs();
  return currentBlocks(courtId).find((b) => ms(b.startAt) <= now) ?? null;
}

export function liveBookingsOverlapping(courtId: number, startIso: string, endIso: string, excludeCode?: string): Booking[] {
  return db().bookings.filter(
    (b) =>
      b.courtId === courtId &&
      LIVE_STATUSES.includes(b.status) &&
      b.bookingCode !== excludeCode &&
      overlaps(startIso, endIso, b.startAt, b.endAt),
  );
}

export interface SlotDef {
  start: string;
  end: string;
  priceLabel: string | null;
  isPeak: boolean;
}

/** Chia [OpenTime, CloseTime) theo slotMinutes của bộ môn */
export function slotsFor(branch: Branch, sport: Sport, date: string): SlotDef[] {
  const day = branchDay(branch, date);
  if (day.isClosed || day.holiday || !day.openTime || !day.closeTime) return [];
  const sample = db().courts.find((c) => c.branchId === branch.branchId && c.sportId === sport.sportId && c.status === 'ACTIVE');
  const out: SlotDef[] = [];
  const close = toMin(day.closeTime);
  for (let m = toMin(day.openTime); m + sport.slotMinutes <= close; m += sport.slotMinutes) {
    const start = fromMin(m);
    const label = sample ? ruleLabelAt(sample, date, start) : null;
    out.push({ start, end: fromMin(m + sport.slotMinutes), priceLabel: label, isPeak: !!label && /cao điểm/i.test(label) });
  }
  return out;
}

export interface BookableInput {
  court: Court;
  date: string;
  startTime: string;
  endTime: string;
  excludeCode?: string;
  /** Bỏ qua kiểm tra giờ đã qua (dùng cho seed dữ liệu quá khứ) */
  allowPast?: boolean;
}

/** Kiểm tra đầy đủ trước khi giữ chỗ — SDD 2.5 và API-12/13 */
export function assertBookable(input: BookableInput) {
  const { court, date, startTime, endTime } = input;
  if (!isDate(date)) throw E.field('date', 'Ngày không hợp lệ (YYYY-MM-DD).');
  if (!isTime(startTime) || !isTime(endTime)) throw E.field('startTime', 'Giờ không hợp lệ (HH:mm).');
  if (toMin(startTime) >= toMin(endTime)) throw E.field('endTime', 'Giờ kết thúc phải sau giờ bắt đầu.');

  const branch = mustBranch(court.branchId);
  const sport = mustSport(court.sportId);
  const startIso = at(date, startTime);
  const endIso = at(date, endTime);

  if (court.status !== 'ACTIVE' || branch.status !== 'ACTIVE') {
    throw E.rule('COURT_UNAVAILABLE', 'Sân đang bảo trì hoặc ngừng hoạt động.');
  }
  if (!input.allowPast && ms(startIso) < nowMs()) {
    throw E.rule('BOOKING_IN_PAST', 'Không thể đặt khung giờ đã qua.');
  }
  const day = branchDay(branch, date);
  if (day.holiday || day.isClosed || !day.openTime || !day.closeTime) {
    throw E.rule('BRANCH_CLOSED', day.holiday ? `Cơ sở nghỉ ngày đã chọn: ${day.holiday.reason}.` : 'Cơ sở nghỉ ngày đã chọn.');
  }
  if (toMin(startTime) < toMin(day.openTime) || toMin(endTime) > toMin(day.closeTime)) {
    throw E.rule('OUTSIDE_OPENING_HOURS', `Khung giờ nằm ngoài giờ mở cửa (${day.openTime}–${day.closeTime}).`);
  }
  const step = sport.gridBlockMinutes;
  if ((toMin(startTime) - toMin(day.openTime)) % step !== 0 || (toMin(endTime) - toMin(startTime)) % step !== 0) {
    throw E.rule('INVALID_TIME_STEP', `Giờ bắt đầu và thời lượng phải là bội số ${step} phút.`);
  }
  if (blocksOverlapping(court.courtId, startIso, endIso).length) {
    throw E.rule('COURT_UNAVAILABLE', 'Sân đang bảo trì hoặc ngừng hoạt động trong khung giờ đã chọn.');
  }
  const priceLines = calcPriceLines(court, date, startTime, endTime);
  if (liveBookingsOverlapping(court.courtId, startIso, endIso, input.excludeCode).length) {
    throw E.conflict('SLOT_TAKEN', 'Khung giờ đã có người đặt, vui lòng chọn khung giờ khác.');
  }
  return { branch, sport, startIso, endIso, priceLines };
}

export interface AffectedReason {
  type: 'COURT_BLOCK' | 'HOLIDAY' | 'OPENING_HOURS' | 'COURT_INACTIVE';
  refId: number | null;
  description: string;
}

/** UC 021 — đơn tương lai bị ảnh hưởng bởi khóa sân / ngày nghỉ / giờ mở cửa / sân ngừng */
export function affectedReasons(b: Booking): AffectedReason[] {
  if (b.status !== 'PENDING_PAYMENT' && b.status !== 'CONFIRMED') return [];
  if (ms(b.startAt) < nowMs()) return [];
  const court = findCourt(b.courtId);
  const branch = findBranch(b.branchId);
  if (!court || !branch) return [];
  const out: AffectedReason[] = [];
  for (const blk of blocksOverlapping(court.courtId, b.startAt, b.endAt)) {
    out.push({
      type: 'COURT_BLOCK',
      refId: blk.blockId,
      description: `${court.name} ${blk.blockType === 'MAINTENANCE' ? 'tạm khóa bảo trì' : 'ngừng khai thác'}: ${blk.reason}`,
    });
  }
  const date = dateOf(b.startAt);
  const hol = holidayOf(branch.branchId, date);
  if (hol) out.push({ type: 'HOLIDAY', refId: hol.holidayId, description: `${branch.name} nghỉ: ${hol.reason}` });
  const day = branchDay(branch, date);
  if (!hol) {
    const st = b.startAt.slice(11, 16);
    const en = b.endAt.slice(11, 16) === '00:00' ? '24:00' : b.endAt.slice(11, 16);
    if (day.isClosed || !day.openTime || !day.closeTime) {
      out.push({ type: 'OPENING_HOURS', refId: null, description: `${branch.name} không mở cửa ngày này.` });
    } else if (toMin(st) < toMin(day.openTime) || toMin(en) > toMin(day.closeTime)) {
      out.push({ type: 'OPENING_HOURS', refId: null, description: `Ngoài giờ mở cửa mới (${day.openTime}–${day.closeTime}).` });
    }
  }
  if (court.status === 'INACTIVE') {
    out.push({ type: 'COURT_INACTIVE', refId: court.courtId, description: `${court.name} ngừng hoạt động.` });
  }
  return out;
}
