// Sinh khung giờ động theo giờ mở cửa từng thứ của chi nhánh (dùng chung Online & Quầy)
import type { Branch, DayHours, Holiday } from '../data'
import { dayIndex, hhmm, mins } from '../utils/format'

export interface Slot { start: string; end: string; label?: string }

/** Khối giờ căn theo bội số của blockMins tính từ 00:00, nằm trọn trong [open, close]. */
export function generateSlots(open: string, close: string, blockMins = 120): Slot[] {
  const o = mins(open), c = mins(close)
  const out: Slot[] = []
  for (let t = Math.ceil(o / blockMins) * blockMins; t + blockMins <= c; t += blockMins) out.push({ start: hhmm(t), end: hhmm(t + blockMins) })
  return out
}

export const hoursOn = (b: Branch, date: string): DayHours => b.hours[dayIndex(date)]

export const holidayOn = (holidays: Holiday[], date: string, branchId?: string) =>
  holidays.find((h) => date >= h.date && date <= h.endDate && (!h.branchId || h.branchId === branchId))

/** Danh sách khung giờ của chi nhánh trong ngày (rỗng nếu đóng cửa / nghỉ lễ). */
export function slotsFor(b: Branch, holidays: Holiday[], date: string): Slot[] {
  const h = hoursOn(b, date)
  if (h.closed || holidayOn(holidays, date, b.id)) return []
  return generateSlots(h.open, h.close)
}

export const slotHours = (s: Slot) => (mins(s.end) - mins(s.start)) / 60

export interface Selection { courtId: string; idxs: number[] }
/** Chọn nhiều ô liền kề cùng một sân (D7): bấm ô kề để mở rộng, bấm ô đầu/cuối để thu hẹp, bấm ô xa để chọn lại. */
export function toggleSelection(cur: Selection | null, courtId: string, i: number): Selection | null {
  if (!cur || cur.courtId !== courtId) return { courtId, idxs: [i] }
  const lo = Math.min(...cur.idxs), hi = Math.max(...cur.idxs)
  if (cur.idxs.includes(i)) {
    if (cur.idxs.length === 1) return null
    if (i === lo || i === hi) return { courtId, idxs: cur.idxs.filter((x) => x !== i) }
    return { courtId, idxs: [i] }
  }
  if (i === lo - 1 || i === hi + 1) return { courtId, idxs: [...cur.idxs, i].sort((a, b) => a - b) }
  return { courtId, idxs: [i] }
}
