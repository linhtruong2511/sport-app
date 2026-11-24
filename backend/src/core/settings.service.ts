import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from './clock.js';
import { DbTransactionService } from './db/transaction.js';

interface SystemSettingRow {
  SettingKey: string;
  SettingValue: string;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class SettingsService {
  private cache: Map<string, string> | null = null;
  private cachedAtMs: number | null = null;
  private overrides = new Map<string, string>();

  constructor(
    private readonly db: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getAll(): Promise<Record<string, string>> {
    const nowMs = this.clock.now().getTime();
    if (!this.cache || this.cachedAtMs === null || nowMs - this.cachedAtMs >= CACHE_TTL_MS) {
      const exec = await this.db.executor();
      const result = await exec
        .request()
        .query<SystemSettingRow>('SELECT SettingKey, SettingValue FROM dbo.SystemSettings');

      const nextCache = new Map<string, string>();
      for (const row of result.recordset) {
        nextCache.set(row.SettingKey, row.SettingValue);
      }
      this.cache = nextCache;
      this.cachedAtMs = nowMs;
    }

    const merged: Record<string, string> = {};
    for (const [k, v] of this.cache) {
      merged[k] = v;
    }
    for (const [k, v] of this.overrides) {
      merged[k] = v;
    }
    return merged;
  }

  async getInt(key: string): Promise<number> {
    let raw: string | undefined = this.overrides.get(key);
    if (raw === undefined) {
      const all = await this.getAll();
      raw = all[key];
    }
    if (raw === undefined) {
      throw new Error(`Missing SystemSettings key: "${key}"`);
    }
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(`SystemSettings key "${key}" is not a valid integer: "${raw}"`);
    }
    return Number.parseInt(trimmed, 10);
  }

  invalidate(): void {
    this.cache = null;
    this.cachedAtMs = null;
  }

  setOverrides(
    map: Record<string, string | number> | Map<string, string | number> | null,
  ): void {
    this.overrides.clear();
    if (!map) {
      return;
    }
    const entries = map instanceof Map ? map.entries() : Object.entries(map);
    for (const [key, value] of entries) {
      this.overrides.set(key, String(value));
    }
  }
}
