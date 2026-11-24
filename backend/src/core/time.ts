export const VN_OFFSET_MS = 7 * 3600_000;

export type VnDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function toVnShiftedDate(date: Date): Date {
  return new Date(date.getTime() + VN_OFFSET_MS);
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid YYYY-MM-DD date: "${dateStr}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${dateStr}"`);
  }
  return { year, month, day };
}

function parseTimeParts(timeStr: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr);
  if (!match) {
    throw new Error(`Invalid time string: "${timeStr}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] !== undefined ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Out-of-range time string: "${timeStr}"`);
  }
  return { hour, minute, second };
}

/**
 * Converts a real instant Date into a Date whose UTC components hold Vietnam wall-clock time
 * for SQL Server DATETIME2(0) parameters (works identically for tedious with useUTC: true and msnodesqlv8).
 */
export function toSqlDateTime(date: Date): Date {
  return new Date(date.getTime() + VN_OFFSET_MS);
}

/**
 * Converts a SQL Server DATETIME2(0) value (Vietnam wall-clock stored in UTC components, or string)
 * back into a real JS instant Date.
 */
export function fromSqlDateTime(val: Date | string): Date {
  if (val instanceof Date) {
    return new Date(val.getTime() - VN_OFFSET_MS);
  }
  const trimmed = val.trim();
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const iso = hasOffset ? normalized : `${normalized}+07:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid SQL datetime string: "${val}"`);
  }
  return parsed;
}

export function toSqlDate(dateStr: string): Date {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day));
}

export function fromSqlDate(val: Date | string): string {
  if (val instanceof Date) {
    return `${pad4(val.getUTCFullYear())}-${pad2(val.getUTCMonth() + 1)}-${pad2(val.getUTCDate())}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(val.trim());
  if (match) {
    parseDateParts(match[1]);
    return match[1];
  }
  const parsed = new Date(val);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid SQL date string: "${val}"`);
  }
  return `${pad4(parsed.getUTCFullYear())}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
}

export function fromSqlTime(val: Date | string): string {
  if (val instanceof Date) {
    return `${pad2(val.getUTCHours())}:${pad2(val.getUTCMinutes())}`;
  }
  const trimmed = val.trim();
  const isoTime = /T(\d{2}:\d{2})/.exec(trimmed);
  if (isoTime) {
    return isoTime[1];
  }
  const plainTime = /^(\d{2}:\d{2})/.exec(trimmed);
  if (plainTime) {
    return plainTime[1];
  }
  throw new Error(`Invalid SQL time string: "${val}"`);
}

export function toSqlTimeString(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim());
  if (!match) {
    throw new Error(`Invalid HH:mm time string: "${hhmm}"`);
  }
  if (match[3] !== undefined) {
    return `${match[1]}:${match[2]}:${match[3]}`;
  }
  return `${match[1]}:${match[2]}:00`;
}

export function toIsoVn(date: Date): string {
  const vn = toVnShiftedDate(date);
  return (
    `${pad4(vn.getUTCFullYear())}-${pad2(vn.getUTCMonth() + 1)}-${pad2(vn.getUTCDate())}` +
    `T${pad2(vn.getUTCHours())}:${pad2(vn.getUTCMinutes())}:${pad2(vn.getUTCSeconds())}+07:00`
  );
}

export function formatDateVn(date: Date): string {
  const vn = toVnShiftedDate(date);
  return `${pad4(vn.getUTCFullYear())}-${pad2(vn.getUTCMonth() + 1)}-${pad2(vn.getUTCDate())}`;
}

export function formatTimeVn(date: Date): string {
  const vn = toVnShiftedDate(date);
  return `${pad2(vn.getUTCHours())}:${pad2(vn.getUTCMinutes())}`;
}

export function toDateKey(date: Date): string {
  const vn = toVnShiftedDate(date);
  return `${pad4(vn.getUTCFullYear())}${pad2(vn.getUTCMonth() + 1)}${pad2(vn.getUTCDate())}`;
}

export function parseVnDateTime(dateStr: string, timeStr: string): Date {
  const { year, month, day } = parseDateParts(dateStr);
  const { hour, minute, second } = parseTimeParts(timeStr);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - VN_OFFSET_MS);
}

/**
 * Returns Vietnam day of week where 1 = Monday ... 7 = Sunday.
 */
export function vnDayOfWeek(input: Date | string): VnDayOfWeek {
  let jsDay: number;
  if (input instanceof Date) {
    jsDay = toVnShiftedDate(input).getUTCDay();
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    jsDay = toSqlDate(input.trim()).getUTCDay();
  } else {
    jsDay = toVnShiftedDate(fromSqlDateTime(input)).getUTCDay();
  }
  return (jsDay === 0 ? 7 : jsDay) as VnDayOfWeek;
}

export function dayOfWeekBit(dow: VnDayOfWeek): number {
  return 1 << (dow - 1);
}

export function parseTimeToMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) {
    throw new Error(`Invalid HH:mm time: "${hhmm}"`);
  }
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 24 || mm > 59 || (hh === 24 && mm !== 0)) {
    throw new Error(`Out-of-range HH:mm time: "${hhmm}"`);
  }
  return hh * 60 + mm;
}

export function minutesToTime(mins: number): string {
  if (!Number.isInteger(mins) || mins < 0 || mins > 1440) {
    throw new Error(`Invalid minutes value: ${mins}`);
  }
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

export function addMinutes(date: Date, m: number): Date {
  return new Date(date.getTime() + m * 60_000);
}

export function addSeconds(date: Date, s: number): Date {
  return new Date(date.getTime() + s * 1_000);
}

export function addDays(date: Date, d: number): Date {
  return new Date(date.getTime() + d * 86_400_000);
}

export function diffSeconds(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 1_000;
}
