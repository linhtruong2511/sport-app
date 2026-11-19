// Đơn giá, khuyến mãi & tiền cọc (hàm thuần)
import type { Court, Promo } from '../data'
import { branchOf } from '../data'
import { fmt, hh, mins, toVN } from '../utils/format'
import type { Slot } from './slots'
import { slotHours } from './slots'

const endHour = (t: string) => (t === '24:00' ? 24 : hh(t))

/** Đơn giá/giờ tại giờ bắt đầu `hour` theo bảng giá nhiều khung của sân. */
export function rateAt(c: Court, hour: number) {
  const r = c.priceRules.find((x) => hh(x.start) <= hour && hour < endHour(x.end))
  return (r ?? c.priceRules[hour < 12 ? 0 : c.priceRules.length - 1])?.price ?? 0
}
export const ruleLabelAt = (c: Court, hour: number) => c.priceRules.find((x) => hh(x.start) <= hour && hour < endHour(x.end))?.label ?? ''
/** Tiền thuê một khung giờ = tổng đơn giá của từng giờ trong khung. */
export function slotPrice(c: Court, s: Slot) {
  let sum = 0
  for (let h = hh(s.start); h < Math.ceil(mins(s.end) / 60); h++) sum += rateAt(c, h)
  return sum
}
export const slotsPrice = (c: Court, ss: Slot[]) => ss.reduce((a, s) => a + slotPrice(c, s), 0)
export const slotsHours = (ss: Slot[]) => ss.reduce((a, s) => a + slotHours(s), 0)

/** Tiền cọc theo cấu hình sân (UC 007): % hoặc số tiền cố định, không vượt tổng tiền. */
export const depositFor = (c: Court, total: number) => Math.min(total, c.depositType === 'percent' ? Math.round((total * c.deposit) / 100) : c.deposit)
export const depositIsFull = (c: Court, total: number) => total > 0 && depositFor(c, total) >= total
export const depositLabel = (c: Court) => (c.depositType === 'percent' ? `${c.deposit}%` : `${fmt(c.deposit)}đ`)

export const promoActive = (p: Promo) => p.status === 'active'
export const promoSummary = (p: Promo) => (p.discountType === 'percent' ? `${p.percent}%${p.maxOff ? ` (tối đa ${fmt(p.maxOff)}đ)` : ''}` : `${fmt(p.fixedOff)}đ`)

export interface PromoResult { ok: boolean; off: number; msg: string }
export function evalPromo(p: Promo | undefined, court: Court, date: string, slots: Slot[], base: number, opts: { counter?: boolean; phone?: string } = {}): PromoResult {
  const no = (msg: string) => ({ ok: false, off: 0, msg })
  if (!p) return no('Mã giảm giá không tồn tại.')
  if (p.status === 'discontinued') return no('Chương trình ưu đãi đã kết thúc.')
  if (p.status === 'paused') return no(`Mã ${p.code} đang tạm dừng.`)
  if (p.counterOnly && !opts.counter) return no(`Mã ${p.code} chỉ áp dụng khi đặt tại quầy.`)
  if (date < p.start || date > p.end) return no(`Mã ${p.code} chỉ có hiệu lực ${toVN(p.start)} – ${toVN(p.end)}.`)
  if (p.used >= p.limit) return no(`Mã ${p.code} đã hết lượt sử dụng.`)
  if (slots.some((s) => hh(s.start) < p.fromHour || hh(s.start) >= p.toHour)) return no(`Mã ${p.code} chỉ áp dụng khung ${String(p.fromHour).padStart(2, '0')}:00 – ${String(p.toHour).padStart(2, '0')}:00.`)
  if (p.branchId && p.branchId !== court.branchId) return no(`Mã ${p.code} chỉ áp dụng tại ${branchOf(p.branchId).name}.`)
  if (p.sports && p.sports.length && !p.sports.includes(court.sport)) return no(`Mã ${p.code} không áp dụng cho bộ môn này.`)
  if (p.targetAudience === 'specific' && !(opts.phone && p.targetPhones.includes(opts.phone))) return no(`Mã ${p.code} không áp dụng cho tài khoản của bạn.`)
  let off = p.discountType === 'percent' ? Math.round((base * p.percent) / 100) : p.fixedOff
  if (p.discountType === 'percent' && p.maxOff) off = Math.min(off, p.maxOff)
  off = Math.min(off, base)
  return { ok: true, off, msg: `✓ Đã áp dụng mã ${p.code}: Giảm ${p.discountType === 'percent' ? `${p.percent}%` : `${fmt(p.fixedOff)}đ`} tiền thuê sân.` }
}
