// Dashboard ngày (UC 015) & Báo cáo doanh thu (UC 023) tính từ dữ liệu thật trong store
import type { Booking, Branch, Court, Holiday, Lock, PaymentTx } from '../data'
import { retainedOf } from '../data'
import { addDays, daysBetween, mins } from '../utils/format'
import { hoursOn, holidayOn } from './slots'

const ACTIVE = ['confirmed', 'playing', 'overdue', 'completed']

/** Chia doanh thu giữ lại của đơn theo tỷ trọng giao dịch QR / tiền mặt (QR + Tiền mặt luôn = tổng). */
function splitOf(b: Booking, txs: PaymentTx[]) {
  const r = retainedOf(b)
  const mine = txs.filter((t) => t.bookingId === b.id)
  const tot = mine.reduce((s, t) => s + t.amount, 0)
  if (r <= 0) return { qr: 0, cash: 0 }
  if (tot <= 0) return b.method === 'cash' ? { qr: 0, cash: r } : { qr: r, cash: 0 }
  const cash = Math.round((r * mine.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amount, 0)) / tot)
  return { qr: r - cash, cash }
}

export interface DailyStats {
  rows: Booking[]; live: Booking[]; online: number; counter: number
  playingCourtIds: string[]; maintCourtIds: string[]; courts: Court[]
  waitingPay: Booking[]; waitingPick: Booking[]
  revenue: number; qr: number; cash: number; fullAmt: number; partAmt: number; keptAmt: number
}

export function computeDailyStats(a: { bookings: Booking[]; courts: Court[]; locks: Lock[]; txs: PaymentTx[]; branchId: string; date: string }): DailyStats {
  const courts = a.courts.filter((c) => a.branchId === 'all' || c.branchId === a.branchId)
  const ids = new Set(courts.map((c) => c.id))
  const rows = a.bookings.filter((b) => b.date === a.date && ids.has(b.courtId))
  const live = rows.filter((b) => b.status !== 'cancelled' && b.status !== 'expired')
  const lockOn = (id: string) => a.locks.some((l) => l.courtId === id && l.from.slice(0, 10) <= a.date && l.to.slice(0, 10) >= a.date)
  let qr = 0, cash = 0
  for (const b of rows) { const s = splitOf(b, a.txs); qr += s.qr; cash += s.cash }
  const kept = rows.filter((b) => b.status === 'cancelled' && b.cancelCategory !== 'facility').reduce((s, b) => s + (b.keptDeposit ?? 0), 0)
  const done = live.filter((b) => b.paid >= b.total)
  const part = live.filter((b) => b.paid < b.total)
  return {
    rows, live, online: live.filter((b) => b.source === 'online').length, counter: live.filter((b) => b.source === 'counter').length,
    playingCourtIds: [...new Set(rows.filter((b) => b.status === 'playing').map((b) => b.courtId))],
    maintCourtIds: courts.filter((c) => lockOn(c.id)).map((c) => c.id), courts,
    waitingPay: rows.filter((b) => b.status === 'pending'), waitingPick: rows.filter((b) => b.status === 'confirmed' || b.status === 'overdue'),
    revenue: qr + cash, qr, cash, fullAmt: done.reduce((s, b) => s + b.paid, 0), partAmt: part.reduce((s, b) => s + b.paid, 0), keptAmt: kept,
  }
}

export interface ReportRow {
  key: string; label: string; courts: number; orders: number; done: number; cancelled: number; expired: number; facility: number
  bookedHours: number; capHours: number; occ: number
  fromDone: number; fromUpcoming: number; fromCancel: number; total: number; qr: number; cash: number
}
const emptyRow = (key: string, label: string, courts: number): ReportRow => ({ key, label, courts, orders: 0, done: 0, cancelled: 0, expired: 0, facility: 0, bookedHours: 0, capHours: 0, occ: 0, fromDone: 0, fromUpcoming: 0, fromCancel: 0, total: 0, qr: 0, cash: 0 })

export interface RevenueReport {
  byBranch: ReportRow[]; byCourt: ReportRow[]; total: ReportRow; empty: boolean
  promoOrders: number; promoDiscount: number; promoRevenue: number
}

export function computeRevenueReport(a: { bookings: Booking[]; courts: Court[]; branches: Branch[]; holidays: Holiday[]; txs: PaymentTx[]; from: string; to: string; branchId: string; courtId: string }): RevenueReport {
  const courts = a.courts.filter((c) => (a.branchId === 'all' || c.branchId === a.branchId) && (a.courtId === 'all' || c.id === a.courtId))
  const courtRow = new Map(courts.map((c) => [c.id, emptyRow(c.id, c.name, 1)]))
  const bookings = a.bookings.filter((b) => b.date >= a.from && b.date <= a.to && courtRow.has(b.courtId))
  // Công suất: số giờ mở cửa của từng sân (trừ ngày nghỉ) trong kỳ
  const nDays = Math.max(0, daysBetween(a.from, a.to) + 1)
  for (const c of courts) {
    const br = a.branches.find((x) => x.id === c.branchId)!
    let cap = 0
    for (let i = 0; i < Math.min(nDays, 400); i++) {
      const d = addDays(a.from, i), h = hoursOn(br, d)
      if (!c.active || h.closed || holidayOn(a.holidays, d, br.id)) continue
      cap += (mins(h.close) - mins(h.open)) / 60
    }
    courtRow.get(c.id)!.capHours = cap
  }
  let promoOrders = 0, promoDiscount = 0, promoRevenue = 0
  for (const b of bookings) {
    const r = courtRow.get(b.courtId)!
    r.orders++
    if (b.status === 'completed') r.done++
    if (b.status === 'cancelled' && b.cancelCategory !== 'facility') r.cancelled++
    if (b.status === 'cancelled' && b.cancelCategory === 'facility') r.facility++
    if (b.status === 'expired') r.expired++
    if (ACTIVE.includes(b.status)) r.bookedHours += (mins(b.end) - mins(b.start)) / 60
    const ret = retainedOf(b)
    if (b.status === 'completed') r.fromDone += ret
    else if (b.status === 'cancelled') r.fromCancel += ret
    else r.fromUpcoming += ret
    const s = splitOf(b, a.txs)
    r.qr += s.qr; r.cash += s.cash; r.total += ret
    if (b.promo && ACTIVE.includes(b.status)) { promoOrders++; promoDiscount += b.discount; promoRevenue += ret }
  }
  const sum = (rows: ReportRow[], key: string, label: string) => {
    const t = emptyRow(key, label, rows.reduce((s, r) => s + r.courts, 0))
    t.orders = rows.reduce((s, r) => s + r.orders, 0)
    t.done = rows.reduce((s, r) => s + r.done, 0)
    t.cancelled = rows.reduce((s, r) => s + r.cancelled, 0)
    t.expired = rows.reduce((s, r) => s + r.expired, 0)
    t.facility = rows.reduce((s, r) => s + r.facility, 0)
    t.bookedHours = rows.reduce((s, r) => s + r.bookedHours, 0)
    t.capHours = rows.reduce((s, r) => s + r.capHours, 0)
    t.fromDone = rows.reduce((s, r) => s + r.fromDone, 0)
    t.fromUpcoming = rows.reduce((s, r) => s + r.fromUpcoming, 0)
    t.fromCancel = rows.reduce((s, r) => s + r.fromCancel, 0)
    t.total = rows.reduce((s, r) => s + r.total, 0)
    t.qr = rows.reduce((s, r) => s + r.qr, 0)
    t.cash = rows.reduce((s, r) => s + r.cash, 0)
    return t
  }
  const finish = (r: ReportRow): ReportRow => ({ ...r, occ: r.capHours ? Math.min(100, Math.round((r.bookedHours / r.capHours) * 100)) : 0 })
  const byCourt = [...courtRow.values()].map(finish)
  const byBranch = a.branches
    .filter((b) => a.branchId === 'all' || b.id === a.branchId)
    .map((b) => finish(sum(byCourt.filter((r) => courts.find((c) => c.id === r.key)?.branchId === b.id), b.id, b.name)))
  const total = finish(sum(byCourt, 'all', 'Tất cả'))
  return { byBranch, byCourt, total, empty: bookings.length === 0, promoOrders, promoDiscount, promoRevenue }
}
