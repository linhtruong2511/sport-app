// Tiện ích định dạng & thời gian dùng chung (không phụ thuộc React)
import type { Role } from '../data'

export const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
export const vnd = (n: number) => `${fmt(n)} VNĐ`
export const money = (n: number) => `${fmt(n)}đ`
export const kfmt = (n: number) => `${Math.round(n / 1000)}k`

export const toVN = (iso: string) => iso.split('-').reverse().join('/')
export const hh = (t: string) => parseInt(t.split(':')[0], 10)
export const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const dow = (iso: string) => ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][new Date(iso + 'T00:00:00').getDay()]
export const dayIndex = (iso: string) => new Date(iso + 'T00:00:00').getDay()

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const daysBetween = (a: string, b: string) => Math.round((+new Date(b + 'T00:00:00') - +new Date(a + 'T00:00:00')) / 86400000)

export const initials = (name: string) => {
  const w = name.split(' ').filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase()
}
export const homeOf = (role: Role) => (role === 'customer' ? '/' : role === 'staff' ? '/staff/booking' : '/owner/staff')

/** Thời điểm hiện tại (ms) — gom lại một chỗ để tách khỏi quá trình render. */
export const nowMs = () => Date.now()
/** Nhãn thời gian hiển thị, khớp ngày demo: "14:20 ngày 12/11/2026". */
export function stamp(demoDate: string) {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ngày ${toVN(demoDate)}`
}
