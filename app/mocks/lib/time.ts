/**
 * Tiện ích thời gian theo giờ Việt Nam (UTC+7) — SDD mục 3.2 / 5.1.
 * Mọi thời điểm trả về dạng 2026-11-12T18:00:00+07:00.
 */
const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

const pad = (n: number, len = 2) => String(n).padStart(len, '0');
const shifted = (d: Date) => new Date(d.getTime() + OFFSET_MS);

export function toIso(d: Date): string {
  const v = shifted(d);
  return (
    `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}` +
    `T${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}+07:00`
  );
}

export const nowMs = () => Date.now();
export const nowIso = () => toIso(new Date());
export const today = () => nowIso().slice(0, 10);
export const ms = (iso: string) => new Date(iso).getTime();

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Ghép ngày + giờ (hỗ trợ "24:00") thành ISO */
export function at(date: string, hhmm: string): string {
  const base = new Date(`${date}T00:00:00+07:00`).getTime();
  return toIso(new Date(base + toMin(hhmm) * 60_000));
}

export const addMinutes = (iso: string, n: number) => toIso(new Date(ms(iso) + n * 60_000));
export const addDays = (date: string, n: number) =>
  toIso(new Date(new Date(`${date}T00:00:00+07:00`).getTime() + n * DAY_MS)).slice(0, 10);

/** 1 = Thứ 2 ... 7 = Chủ nhật */
export function dow(date: string): number {
  const w = shifted(new Date(`${date}T12:00:00+07:00`)).getUTCDay();
  return w === 0 ? 7 : w;
}

export const dateOf = (iso: string) => iso.slice(0, 10);
export const timeOf = (iso: string) => iso.slice(11, 16);
/** Giờ kết thúc hiển thị — đơn kết thúc 00:00 hôm sau hiển thị "24:00" */
export const endTimeOf = (startIso: string, endIso: string) =>
  dateOf(endIso) > dateOf(startIso) && timeOf(endIso) === '00:00' ? '24:00' : timeOf(endIso);

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isTime = (s: unknown): s is string =>
  typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s);
export const compactDate = (date: string) => date.replace(/-/g, '');

export function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export const diffDays = (fromDate: string, toDate: string) =>
  Math.round((new Date(`${toDate}T00:00:00+07:00`).getTime() - new Date(`${fromDate}T00:00:00+07:00`).getTime()) / DAY_MS);

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string | null) =>
  ms(aStart) < (bEnd ? ms(bEnd) : Number.POSITIVE_INFINITY) && ms(aEnd) > ms(bStart);

export const minIso = (a: string, b: string) => (ms(a) <= ms(b) ? a : b);
