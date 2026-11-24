import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../clock.js';
import type { DbTransactionService } from '../db/transaction.js';
import { SettingsService } from '../settings.service.js';

function createMockDb(rows: Array<{ SettingKey: string; SettingValue: string }>) {
  const query = vi.fn().mockResolvedValue({ recordset: rows });
  const executor = vi.fn().mockResolvedValue({
    request: () => ({ query }),
  });
  return {
    db: { executor } as unknown as DbTransactionService,
    query,
    executor,
  };
}

describe('core/SettingsService', () => {
  it('loads settings from DB, caches for 60s via Clock, and supports invalidate & overrides', async () => {
    const clock = new FakeClock(new Date('2026-11-25T10:00:00+07:00'));
    const { db, query } = createMockDb([
      { SettingKey: 'BOOKING_HOLD_MINUTES', SettingValue: '10' },
      { SettingKey: 'NO_SHOW_GRACE_MINUTES', SettingValue: '30' },
      { SettingKey: 'BAD_INT', SettingValue: 'abc' },
    ]);

    const service = new SettingsService(db, clock);

    expect(await service.getInt('BOOKING_HOLD_MINUTES')).toBe(10);
    expect(query).toHaveBeenCalledTimes(1);

    // Still cached at +59s
    clock.advanceSeconds(59);
    expect(await service.getInt('NO_SHOW_GRACE_MINUTES')).toBe(30);
    expect(query).toHaveBeenCalledTimes(1);

    // Cache expires at +60s
    clock.advanceSeconds(1);
    expect(await service.getInt('BOOKING_HOLD_MINUTES')).toBe(10);
    expect(query).toHaveBeenCalledTimes(2);

    // Manual invalidate forces refresh
    service.invalidate();
    await service.getAll();
    expect(query).toHaveBeenCalledTimes(3);

    // Overrides win over DB values without hitting DB
    service.setOverrides({ BOOKING_HOLD_MINUTES: 15 });
    expect(await service.getInt('BOOKING_HOLD_MINUTES')).toBe(15);
    expect((await service.getAll()).BOOKING_HOLD_MINUTES).toBe('15');
    expect(query).toHaveBeenCalledTimes(3);

    // Clear overrides restores DB value
    service.setOverrides(null);
    expect(await service.getInt('BOOKING_HOLD_MINUTES')).toBe(10);

    // Missing or invalid integer throws
    await expect(service.getInt('MISSING_KEY')).rejects.toThrow();
    await expect(service.getInt('BAD_INT')).rejects.toThrow();
  });
});
