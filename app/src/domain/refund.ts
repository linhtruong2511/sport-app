// Chính sách hoàn tiền bậc thang (FR 12 / UC 009 / D1)
import type { CancelCategory } from '../data'
import { DEMO_NOW_ISO, NO_SHOW_GRACE_MINUTES } from '../data'
import { mins } from '../utils/format'

export interface RefundResult { rate: number; refund: number; kept: number; days: number }

/** Tiền cọc KHÔNG bao giờ hoàn. Phần đã trả vượt cọc: >=5 ngày 100%, 2–<5 ngày 50%, <2 ngày / no-show 0%. */
export function calculateRefund(p: { playDate: string; playStart: string; nowIso?: string; paid: number; depositAmount: number; category: CancelCategory }): RefundResult {
  const diffDays = (new Date(`${p.playDate}T${p.playStart}:00`).getTime() - new Date(p.nowIso ?? DEMO_NOW_ISO).getTime()) / 86_400_000
  if (p.category === 'facility') return { rate: 100, refund: p.paid, kept: 0, days: diffDays }
  if (p.paid <= 0) return { rate: 0, refund: 0, kept: 0, days: diffDays }
  if (p.category === 'noshow') return { rate: 0, refund: 0, kept: p.paid, days: diffDays }
  const nonDeposit = Math.max(0, p.paid - p.depositAmount)
  const rate = diffDays >= 5 ? 100 : diffDays >= 2 ? 50 : 0
  const refund = Math.round((nonDeposit * rate) / 100)
  return { rate, refund, kept: p.paid - refund, days: diffDays }
}

/** Đã quá giờ nhận sân quy định (30 phút) so với giờ demo? */
export function isNoShowEligible(date: string, start: string, nowIso = DEMO_NOW_ISO) {
  const [d, t] = nowIso.split('T')
  if (date < d) return true
  if (date > d) return false
  return mins(t.slice(0, 5)) - mins(start) >= NO_SHOW_GRACE_MINUTES
}
