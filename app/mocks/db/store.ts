import { MOCK_CONFIG } from '../config';
import type { DbState } from './types';
import { buildSeed } from './seed';

/**
 * "CSDL" giả lưu trong bộ nhớ + localStorage.
 * Mỗi request nạp lại từ localStorage và lưu lại sau khi xử lý, nhờ vậy
 * nhiều tab (khách hàng / nhân viên / chủ sân) dùng chung một dữ liệu.
 */
const SCHEMA_VERSION = 1;

const holder: { data: DbState | null } = { data: null };

export const db = (): DbState => {
  if (!holder.data) load();
  return holder.data as DbState;
};

/** Gán trực tiếp — dùng khi dựng dữ liệu seed */
export const setDb = (state: DbState) => {
  holder.data = state;
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function load(): void {
  const ls = storage();
  const raw = ls?.getItem(MOCK_CONFIG.storageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DbState;
      if (parsed.version === SCHEMA_VERSION) {
        holder.data = parsed;
        return;
      }
    } catch {
      /* dữ liệu hỏng → seed lại */
    }
  }
  reset();
}

export function save(): void {
  if (!holder.data) return;
  try {
    storage()?.setItem(MOCK_CONFIG.storageKey, JSON.stringify(holder.data));
  } catch {
    /* hết quota hoặc chế độ riêng tư: giữ trong bộ nhớ */
  }
}

/** Khôi phục dữ liệu mẫu (nút "Khôi phục dữ liệu mẫu (demo)") */
export function reset(): DbState {
  const state = buildSeed(SCHEMA_VERSION);
  holder.data = state;
  save();
  return state;
}

export function nextId(table: string): number {
  const s = db();
  s.ids[table] = (s.ids[table] ?? 0) + 1;
  return s.ids[table];
}

/** CodeSequences: BK2026111001, PT2026111203, KH000006 ... */
export function nextCode(prefix: string, dateKey: string | null): string {
  const s = db();
  const key = `${prefix}:${dateKey ?? '00000000'}`;
  s.seq[key] = (s.seq[key] ?? 0) + 1;
  const n = s.seq[key];
  return dateKey ? `${prefix}${dateKey}${String(n).padStart(2, '0')}` : `${prefix}${String(n).padStart(6, '0')}`;
}
