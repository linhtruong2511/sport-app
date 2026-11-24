import { describe, expect, it } from 'vitest';
import { FakeClock } from '../clock.js';
import {
  VN_OFFSET_MS,
  addDays,
  addMinutes,
  addSeconds,
  dayOfWeekBit,
  diffSeconds,
  formatDateVn,
  formatTimeVn,
  fromSqlDate,
  fromSqlDateTime,
  fromSqlTime,
  minutesToTime,
  parseTimeToMinutes,
  parseVnDateTime,
  toDateKey,
  toIsoVn,
  toSqlDate,
  toSqlDateTime,
  toSqlTimeString,
  vnDayOfWeek,
} from '../time.js';

describe('core/time & FakeClock', () => {
  it('converts between JS Date and Vietnam ISO 8601 regardless of host TZ', () => {
    const instant = new Date('2026-11-24T17:30:05.000Z'); // 2026-11-25 00:30:05 +07:00
    expect(toIsoVn(instant)).toBe('2026-11-25T00:30:05+07:00');
    expect(formatDateVn(instant)).toBe('2026-11-25');
    expect(formatTimeVn(instant)).toBe('00:30');
    expect(toDateKey(instant)).toBe('20261125');
  });

  it('parses Vietnam date and time strings accurately', () => {
    const dt = parseVnDateTime('2026-11-25', '08:15:30');
    expect(dt.toISOString()).toBe('2026-11-25T01:15:30.000Z');
    expect(toIsoVn(dt)).toBe('2026-11-25T08:15:30+07:00');

    const dtNoSec = parseVnDateTime('2026-11-25', '23:45');
    expect(toIsoVn(dtNoSec)).toBe('2026-11-25T23:45:00+07:00');

    expect(() => parseVnDateTime('2026-02-30', '10:00')).toThrow();
    expect(() => parseVnDateTime('2026-11-25', '24:00')).toThrow();
  });

  it('round-trips SQL DATETIME2, DATE, and TIME values without drift', () => {
    const real = parseVnDateTime('2026-11-25', '18:05:09');
    const sqlDt = toSqlDateTime(real);
    expect(sqlDt.getTime() - real.getTime()).toBe(VN_OFFSET_MS);
    expect(sqlDt.toISOString()).toBe('2026-11-25T18:05:09.000Z');
    expect(fromSqlDateTime(sqlDt).getTime()).toBe(real.getTime());

    expect(fromSqlDateTime('2026-11-25 18:05:09').getTime()).toBe(real.getTime());
    expect(fromSqlDateTime('2026-11-25T18:05:09+07:00').getTime()).toBe(real.getTime());

    const sqlD = toSqlDate('2026-11-25');
    expect(sqlD.toISOString()).toBe('2026-11-25T00:00:00.000Z');
    expect(fromSqlDate(sqlD)).toBe('2026-11-25');
    expect(fromSqlDate('2026-11-25')).toBe('2026-11-25');

    expect(fromSqlTime(new Date('1970-01-01T05:30:00.000Z'))).toBe('05:30');
    expect(fromSqlTime('05:30:00')).toBe('05:30');
    expect(toSqlTimeString('05:30')).toBe('05:30:00');
  });

  it('computes Vietnam day of week (1=Mon..7=Sun) and bitmask', () => {
    // 2026-11-23 is Monday. At 01:30 +07:00, UTC is still Sunday 2026-11-22T18:30Z!
    const earlyMondayVn = parseVnDateTime('2026-11-23', '01:30');
    expect(vnDayOfWeek(earlyMondayVn)).toBe(1);
    expect(dayOfWeekBit(1)).toBe(1);

    // 2026-11-29 is Sunday
    expect(vnDayOfWeek('2026-11-29')).toBe(7);
    expect(dayOfWeekBit(7)).toBe(64);

    // Sum of all 7 days = 127
    const allMask = ([1, 2, 3, 4, 5, 6, 7] as const).reduce(
      (acc, d) => acc | dayOfWeekBit(d),
      0,
    );
    expect(allMask).toBe(127);
  });

  it('handles time minutes and date arithmetic', () => {
    expect(parseTimeToMinutes('05:30')).toBe(330);
    expect(parseTimeToMinutes('24:00')).toBe(1440);
    expect(minutesToTime(330)).toBe('05:30');
    expect(minutesToTime(1440)).toBe('24:00');

    const base = parseVnDateTime('2026-11-25', '10:00:00');
    expect(toIsoVn(addMinutes(base, 15))).toBe('2026-11-25T10:15:00+07:00');
    expect(toIsoVn(addSeconds(base, 45))).toBe('2026-11-25T10:00:45+07:00');
    expect(toIsoVn(addDays(base, 5))).toBe('2026-11-30T10:00:00+07:00');
    expect(diffSeconds(addDays(base, 5), base)).toBe(5 * 86_400);
  });

  it('supports FakeClock set and advance helpers', () => {
    const start = parseVnDateTime('2026-11-25', '09:00:00');
    const clock = new FakeClock(start);
    expect(clock.now().getTime()).toBe(start.getTime());

    clock.advanceMinutes(10);
    expect(toIsoVn(clock.now())).toBe('2026-11-25T09:10:00+07:00');

    clock.advanceSeconds(30);
    expect(toIsoVn(clock.now())).toBe('2026-11-25T09:10:30+07:00');

    const target = parseVnDateTime('2026-12-01', '12:00:00');
    clock.set(target);
    expect(clock.now().getTime()).toBe(target.getTime());
  });
});
