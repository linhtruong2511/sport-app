import type { DepositType, DiscountType, UserRole } from '@sporthub/shared';
import { ApiError, getServerNowMs } from '../api/client.ts';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export const fmt = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const vnd = (n: number): string => `${fmt(n)} VNĐ`;
export const money = (n: number): string => `${fmt(n)}đ`;
export const kfmt = (n: number): string => `${Math.round(n / 1000)}k`;

export const toVN = (isoDate: string): string => isoDate.slice(0, 10).split('-').reverse().join('/');

export const mins = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const hhmm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const dow = (isoDate: string): string =>
  ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][
    new Date(`${isoDate.slice(0, 10)}T00:00:00`).getDay()
  ] ?? '';

export const addDays = (isoDate: string, n: number): string => {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const todayVn = (): string => {
  const d = new Date(getServerNowMs() + VN_OFFSET_MS);
  return d.toISOString().slice(0, 10);
};

export const isoDatePart = (iso: string): string => iso.slice(0, 10);
export const isoTimePart = (iso: string): string => iso.slice(11, 16);

export const formatDateTimeVn = (iso: string): string => {
  if (!iso) return '—';
  const datePart = toVN(iso);
  const timePart = iso.length >= 16 ? iso.slice(11, 16) : '';
  return timePart ? `${timePart} • ${datePart}` : datePart;
};

export const formatCountdown = (remainingMs: number): string => {
  const sec = Math.max(0, Math.floor(remainingMs / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const initials = (name: string): string => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? (w[w.length - 1]?.[0] ?? '') : '')).toUpperCase();
};

export const homeOf = (role: UserRole): string =>
  role === 'CUSTOMER' ? '/' : role === 'STAFF' ? '/staff/booking' : '/owner/staff';

export function formatDepositRule(type: DepositType | null, value: number | null): string {
  if (!type || value === null) return 'Theo quy định sân';
  return type === 'PERCENT' ? `${value}%` : vnd(value);
}

export function formatPromoSummary(type: DiscountType, value: number, maxAmount: number | null): string {
  if (type === 'PERCENT') {
    return maxAmount ? `${value}% (tối đa ${kfmt(maxAmount)})` : `${value}%`;
  }
  return vnd(value);
}

export function extractErrorMessage(err: unknown, fallback = 'Đã xảy ra lỗi, vui lòng thử lại.'): string {
  if (err instanceof ApiError) {
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
