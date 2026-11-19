import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BRANCHES, CUSTOMERS_SEED, HOLD_MINUTES, HOLIDAYS_SEED, LOCK_MINUTES, LOCKS_SEED, MAX_FAILED_LOGINS, NOTIFS_SEED, OWNER, PROMOS_SEED,
  RECON_SEED, STAFF_SEED, TODAY, bookingsSeed, buildCourts, txSeed,
} from './data'
import type {
  Booking, CustomerAccount, HistoryItem, NotificationItem, PaymentTx, ReassignLog, ReconciliationItem, RefundItem, Role,
} from './data'
import { AppCtx } from './appContext'
import type { AuthUser, Ctx, Toast } from './appContext'
import { calculateRefund } from './domain/refund'
import { mins, nowMs, stamp, vnd } from './utils/format'

const KEY = 'sporthub.state.v2'
const USER_KEY = 'sporthub.user'

function seedState() {
  const bookings = bookingsSeed(nowMs())
  return {
    customers: CUSTOMERS_SEED, bookings, courts: buildCourts(), staff: STAFF_SEED, promos: PROMOS_SEED, locks: LOCKS_SEED,
    holidays: HOLIDAYS_SEED, branches: BRANCHES, transactions: txSeed(bookings), reconciliations: RECON_SEED,
    refunds: [] as RefundItem[], notifications: NOTIFS_SEED, reassignLogs: [] as ReassignLog[],
    failed: {} as Record<string, { count: number; lockedUntil: number }>,
    receipt: { code: 'PT2026111209', order: '#BK2026111015', amount: 255000, method: 'Tiền mặt', cashier: 'Lê Văn Hùng' } as Ctx['receipt'],
    seq: 1030, seqTx: 2000,
  }
}
type State = ReturnType<typeof seedState>

function loadState(): State {
  const seed = seedState()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...seed, ...JSON.parse(raw) }
  } catch { /* bỏ qua dữ liệu lỗi */ }
  return seed
}

const OPEN = ['pending', 'confirmed', 'overdue', 'playing']

export function AppProvider({ children }: { children: ReactNode }) {
  const [init] = useState(loadState)
  const [user, setUser] = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
  })
  const [customers, setCustomers] = useState(init.customers)
  const [bookings, setBookings] = useState(init.bookings)
  const [courts, setCourts] = useState(init.courts)
  const [staff, setStaff] = useState(init.staff)
  const [promos, setPromos] = useState(init.promos)
  const [locks, setLocks] = useState(init.locks)
  const [holidays, setHolidays] = useState(init.holidays)
  const [branches, setBranches] = useState(init.branches)
  const [transactions, setTransactions] = useState<PaymentTx[]>(init.transactions)
  const [reconciliations, setRecon] = useState<ReconciliationItem[]>(init.reconciliations)
  const [refunds, setRefunds] = useState<RefundItem[]>(init.refunds)
  const [notifications, setNotifs] = useState<NotificationItem[]>(init.notifications)
  const [reassignLogs, setLogs] = useState<ReassignLog[]>(init.reassignLogs)
  const [failed, setFailed] = useState(init.failed)
  const [receipt, setReceipt] = useState<Ctx['receipt']>(init.receipt)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(init.seq)
  const seqTx = useRef(init.seqTx)
  const tid = useRef(1)
  const bookingsRef = useRef(bookings)
  const promosRef = useRef(promos)
  useEffect(() => { bookingsRef.current = bookings; promosRef.current = promos })

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  }, [user])

  // Lưu bền vững toàn bộ dữ liệu mô phỏng để giữ trạng thái khi điều hướng / tải lại trang
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        customers, bookings, courts, staff, promos, locks, holidays, branches, transactions, reconciliations, refunds,
        notifications, reassignLogs, failed, receipt, seq: seq.current, seqTx: seqTx.current,
      }))
    } catch { /* hết dung lượng */ }
  }, [customers, bookings, courts, staff, promos, locks, holidays, branches, transactions, reconciliations, refunds, notifications, reassignLogs, failed, receipt])

  const resetDemo = useCallback(() => {
    localStorage.removeItem(KEY)
    localStorage.removeItem(USER_KEY)
    window.location.assign('/login')
  }, [])
  useEffect(() => {
    (window as unknown as { __SPORTHUB_RESET__: () => void }).__SPORTHUB_RESET__ = resetDemo
  }, [resetDemo])

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = tid.current++
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800)
  }, [])

  const hist = (text: string): HistoryItem => ({ at: stamp(TODAY), text })
  const addHist = (id: string, text: string, patch: Partial<Booking> = {}) =>
    setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch, history: [...b.history, hist(text)] } : b)))
  const releasePromo = (code?: string) => { if (code) setPromos((ps) => ps.map((p) => (p.code === code && p.used > 0 ? { ...p, used: p.used - 1 } : p))) }
  const newTx = (t: Omit<PaymentTx, 'id' | 'at'>) => setTransactions((ts) => [...ts, { ...t, id: `GD${seqTx.current++}`, at: stamp(TODAY) }])

  const pushNotification: Ctx['pushNotification'] = (n) =>
    setNotifs((ns) => [{ ...n, id: `N${nowMs()}${ns.length}`, at: stamp(TODAY), readBy: [] }, ...ns])

  // Tự chuyển "Quá hạn thanh toán" khi hết thời gian giữ chỗ & hoàn lại lượt dùng mã (D2, D10)
  useEffect(() => {
    const t = setInterval(() => {
      const now = nowMs()
      const late = bookingsRef.current.filter((b) => b.status === 'pending' && b.holdUntil && b.holdUntil < now)
      if (!late.length) return
      const ids = new Set(late.map((b) => b.id))
      setBookings((bs) => bs.map((b) => (ids.has(b.id) ? { ...b, status: 'expired', cancelReason: 'Hết hạn giữ chỗ', holdUntil: undefined, history: [...b.history, hist('Quá 10 phút chưa thanh toán — Đơn chuyển Quá hạn thanh toán.')] } : b)))
      for (const b of late) releasePromo(b.promo)
    }, 1500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== Xác thực =====
  type Acc = { role: Role; key: string; name: string; phone: string; email: string; password: string; title: string; locked?: boolean; staffId?: string; branchId?: string }
  const findAccount = (id: string): Acc | undefined => {
    const v = id.trim().toLowerCase()
    const cu = customers.find((c) => c.phone === id.trim() || c.aliases?.includes(id.trim()) || c.email.toLowerCase() === v)
    if (cu) return { role: 'customer', key: cu.phone, name: cu.name, phone: cu.phone, email: cu.email, password: cu.password, title: cu.title }
    const st = staff.find((s) => s.phone === id.trim() || s.email.toLowerCase() === v)
    if (st) return { role: 'staff', key: st.phone, name: st.name, phone: st.phone, email: st.email, password: st.password, title: 'Nhân viên thu ngân', locked: st.locked, staffId: st.id, branchId: st.branchId }
    if (id.trim() === OWNER.phone || v === OWNER.email) return { role: 'owner', key: OWNER.phone, name: OWNER.name, phone: OWNER.phone, email: OWNER.email, password: OWNER.password, title: OWNER.title }
    return undefined
  }

  const login: Ctx['login'] = (identity, password) => {
    const id = identity.trim()
    if (!id) return { ok: false, error: 'Vui lòng nhập số điện thoại hoặc email.' }
    if (password.length < 6) return { ok: false, error: 'Mật khẩu phải có tối thiểu 6 ký tự.' }
    const a = findAccount(id)
    if (!a) return { ok: false, error: 'Không tìm thấy tài khoản với thông tin này.' }
    const now = nowMs()
    const f = failed[a.key]
    if (f && f.lockedUntil > now) {
      const m = Math.max(1, Math.ceil((f.lockedUntil - now) / 60000))
      return { ok: false, error: `Tài khoản đang bị tạm khóa do nhập sai mật khẩu quá ${MAX_FAILED_LOGINS} lần. Vui lòng thử lại sau ${m} phút.` }
    }
    if (a.locked) return { ok: false, error: 'Tài khoản nhân viên đã bị khóa, vui lòng liên hệ chủ hệ thống.' }
    if (a.password !== password) {
      const count = (f && f.lockedUntil === 0 ? f.count : 0) + 1
      if (count >= MAX_FAILED_LOGINS) {
        setFailed((m) => ({ ...m, [a.key]: { count: 0, lockedUntil: now + LOCK_MINUTES * 60000 } }))
        return { ok: false, error: `Bạn đã nhập sai mật khẩu quá ${MAX_FAILED_LOGINS} lần liên tiếp. Tài khoản bị tạm khóa trong ${LOCK_MINUTES} phút.` }
      }
      setFailed((m) => ({ ...m, [a.key]: { count, lockedUntil: 0 } }))
      return { ok: false, error: 'Mật khẩu không chính xác.' }
    }
    setFailed((m) => { const n = { ...m }; delete n[a.key]; return n })
    setUser({ role: a.role, name: a.name, phone: a.phone, email: a.email, staffId: a.staffId, branchId: a.branchId, title: a.title })
    return { ok: true }
  }

  const identityTaken: Ctx['identityTaken'] = (phone, email, exceptStaffId) => {
    const out: ReturnType<Ctx['identityTaken']> = {}
    const em = email.trim().toLowerCase()
    if (customers.some((c) => c.phone === phone || c.aliases?.includes(phone))) out.phone = 'customer'
    else if (staff.some((s) => s.phone === phone && s.id !== exceptStaffId)) out.phone = 'staff'
    else if (phone === OWNER.phone) out.phone = 'owner'
    if (em) {
      if (customers.some((c) => c.email.toLowerCase() === em)) out.email = 'customer'
      else if (staff.some((s) => s.email.toLowerCase() === em && s.id !== exceptStaffId)) out.email = 'staff'
      else if (em === OWNER.email) out.email = 'owner'
    }
    return out
  }

  const register: Ctx['register'] = (v) => {
    const t = identityTaken(v.phone, v.email)
    if (t.phone) return { ok: false, error: 'Số điện thoại này đã được sử dụng. Vui lòng đăng nhập hoặc dùng số khác.' }
    if (t.email) return { ok: false, error: 'Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.' }
    const acc: CustomerAccount = { phone: v.phone, email: v.email.trim(), name: v.name.trim(), password: v.password, title: 'Hội viên mới' }
    setCustomers((cs) => [...cs, acc])
    setUser({ role: 'customer', name: acc.name, phone: acc.phone, email: acc.email, title: acc.title })
    return { ok: true }
  }
  const logout = () => setUser(null)

  // ===== Đơn đặt sân =====
  const peekOrderId: Ctx['peekOrderId'] = (date) => `BK${date.slice(0, 7).replace('-', '')}${seq.current}`

  const createBooking: Ctx['createBooking'] = (b, status, pay) => {
    const id = b.id ?? peekOrderId(b.date)
    if (!b.id || b.id === peekOrderId(b.date)) seq.current++
    const paid = pay?.amount ?? 0
    const history: HistoryItem[] = [hist(`${b.source === 'counter' ? 'Nhân viên tạo đơn tại quầy' : 'Khách tạo đơn đặt sân'} (Chờ thanh toán).`)]
    if (status === 'confirmed') history.push(hist(paid >= b.total ? 'Đã thanh toán đủ — Đơn được xác nhận.' : 'Đã đặt cọc — Đơn được xác nhận.'))
    const nb: Booking = {
      ...b, id, status, paid, createdAt: stamp(TODAY), history,
      holdUntil: status === 'pending' ? nowMs() + HOLD_MINUTES * 60000 : undefined,
    }
    setBookings((bs) => [nb, ...bs])
    if (b.promo) setPromos((ps) => ps.map((p) => (p.code === b.promo ? { ...p, used: p.used + 1 } : p)))
    if (pay && pay.amount > 0) newTx({ bookingId: id, amount: pay.amount, method: pay.method, kind: paid >= b.total ? 'FULL' : 'DEPOSIT', staffId: pay.staffId })
    return nb
  }

  const patchBooking: Ctx['patchBooking'] = (id, p) => setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)))

  const confirmPayment: Ctx['confirmPayment'] = (id, method = 'qr') => {
    const b = bookingsRef.current.find((x) => x.id === id)
    if (!b || b.status !== 'pending') return false
    const paid = b.payMode === 'full' ? b.total : b.depositAmount
    addHist(id, paid >= b.total ? 'Thanh toán đủ 100% qua VietQR — Đơn được xác nhận.' : 'Đặt cọc qua VietQR — Đơn được xác nhận.', { status: 'confirmed', holdUntil: undefined, paid, method })
    newTx({ bookingId: id, amount: paid, method, kind: paid >= b.total ? 'FULL' : 'DEPOSIT' })
    pushNotification({ to: b.phone, type: 'PAYMENT', title: '✅ Thanh toán thành công', body: `Đơn ${id} đã được xác nhận. Bạn đã thanh toán ${vnd(paid)}${paid < b.total ? `, còn ${vnd(b.total - paid)} thanh toán tại quầy khi nhận sân` : ''}.`, bookingId: id })
    return true
  }

  const playingConflict = (b: Booking) => bookingsRef.current.find((x) => x.id !== b.id && x.courtId === b.courtId && x.date === b.date && x.status === 'playing')
  const checkIn: Ctx['checkIn'] = (id) => {
    const b = bookingsRef.current.find((x) => x.id === id)
    if (!b) return { ok: false, error: 'Không tìm thấy đơn.' }
    const c = playingConflict(b)
    if (c) return { ok: false, error: `Sân đang được sử dụng bởi đơn trước (#${c.id}). Vui lòng chờ khách trước trả sân.` }
    addHist(id, 'Khách nhận sân (Đang sử dụng).', { status: 'playing', checkedInAt: stamp(TODAY) })
    return { ok: true }
  }
  const settleBooking: Ctx['settleBooking'] = (id, method, staffId) => {
    const b = bookingsRef.current.find((x) => x.id === id)
    if (!b) return { ok: false, error: 'Không tìm thấy đơn.' }
    const c = playingConflict(b)
    if (c) return { ok: false, error: `Sân đang được sử dụng bởi đơn trước (#${c.id}). Vui lòng chờ khách trước trả sân.` }
    const rem = b.total - b.paid
    if (rem > 0) newTx({ bookingId: id, amount: rem, method, kind: 'SETTLEMENT', staffId })
    addHist(id, `Tất toán ${vnd(rem)} (${method === 'qr' ? 'VietQR' : 'Tiền mặt'}) & khách nhận sân.`, { paid: b.total, status: 'playing', checkedInAt: stamp(TODAY) })
    return { ok: true }
  }
  const completeBooking: Ctx['completeBooking'] = (id) => addHist(id, 'Kết thúc lượt chơi (Hoàn thành).', { status: 'completed', completedAt: stamp(TODAY) })

  const cancelBooking: Ctx['cancelBooking'] = (id, o) => {
    const b = bookingsRef.current.find((x) => x.id === id)
    if (!b) return null
    const r = calculateRefund({ playDate: b.date, playStart: b.start, paid: b.paid, depositAmount: b.depositAmount, category: o.category })
    if (b.paid === 0) releasePromo(b.promo)
    addHist(id, `Đơn bị hủy (${o.category === 'facility' ? 'do cơ sở' : o.category === 'noshow' ? 'khách không đến nhận sân' : 'khách báo hủy'}). Lý do: ${o.reason}${b.paid > 0 ? `. Hoàn ${r.rate}% phần ngoài cọc = ${vnd(r.refund)}; giữ lại ${vnd(r.kept)}.` : ''}`, {
      status: 'cancelled', cancelReason: o.reason, cancelCategory: o.category, holdUntil: undefined, isAffected: false,
      keptDeposit: r.kept, refundRate: r.rate, refundAmount: r.refund, cancelledAt: stamp(TODAY),
    })
    if (r.refund > 0) {
      setRefunds((rs) => [{ id: `HT${nowMs()}${rs.length}`, bookingId: id, customer: b.customer, phone: b.phone, amount: r.refund, rate: r.rate, status: 'PENDING', at: stamp(TODAY), note: o.category === 'facility' ? 'Đóng đơn do cơ sở — hoàn trả ngoài hệ thống' : undefined }, ...rs])
    }
    if (o.by !== 'customer') pushNotification({ to: b.phone, type: 'CANCEL', title: '❌ Đơn đặt sân đã bị hủy', body: `Đơn ${id} đã bị hủy. Lý do: ${o.reason}.${r.refund > 0 ? ` Khoản hoàn dự kiến: ${vnd(r.refund)}.` : ''}`, bookingId: id })
    return r
  }

  const blocker: Ctx['blocker'] = (courtId, date, start, end, ignoreId) =>
    bookings.find((b) => b.id !== ignoreId && b.courtId === courtId && b.date === date && OPEN.includes(b.status)
      && mins(b.start) < mins(end) && mins(b.end) > mins(start))

  const lockAt: Ctx['lockAt'] = (courtId, date, start, end) => {
    const s = `${date}T${start}`, e = `${date}T${end === '24:00' ? '23:59' : end}`
    return locks.find((l) => l.courtId === courtId && l.from < e && l.to > s)
  }

  // ===== UC 021: đơn bị ảnh hưởng =====
  const flagAffected: Ctx['flagAffected'] = (ids, reason) => {
    if (!ids.length) return
    const s = new Set(ids)
    setBookings((bs) => bs.map((b) => (s.has(b.id) ? { ...b, isAffected: true, affectedReason: reason, history: [...b.history, hist(`Đơn bị ảnh hưởng: ${reason}.`)] } : b)))
  }
  const reassignBooking: Ctx['reassignBooking'] = (id, to) => {
    const b = bookingsRef.current.find((x) => x.id === id)
    if (!b) return
    const from = courts.find((c) => c.id === b.courtId)?.name ?? b.courtId
    const toName = courts.find((c) => c.id === to.courtId)?.name ?? to.courtId
    const text = `Chuyển sân/đổi giờ: ${from} (${b.date} ${b.start}-${b.end}) → ${toName} (${to.date} ${to.start}-${to.end}). Giữ nguyên mã đơn & số tiền.`
    addHist(id, text, { courtId: to.courtId, date: to.date, start: to.start, end: to.end, isAffected: false, affectedReason: undefined })
    setLogs((l) => [{ id: `RL${nowMs()}${l.length}`, bookingId: id, text, at: stamp(TODAY), by: user?.name ?? 'Hệ thống' }, ...l])
    pushNotification({ to: b.phone, type: 'REASSIGN', title: '🔁 Lịch đặt của bạn được chuyển sân', body: `Do cơ sở điều chỉnh, đơn ${id} được chuyển sang ${toName}, ${to.start} - ${to.end} ngày ${to.date.split('-').reverse().join('/')}. Mã đơn và số tiền đã thanh toán giữ nguyên.`, bookingId: id })
  }
  const closeByFacility: Ctx['closeByFacility'] = (id, note) => {
    cancelBooking(id, { reason: `Cơ sở đóng/ngừng nhận lịch${note ? `: ${note}` : ''}`, category: 'facility', by: user?.role ?? 'owner' })
  }

  // ===== Đối soát / hoàn tiền / thông báo =====
  const addRecon: Ctx['addRecon'] = (r) => setRecon((rs) => [{ ...r, id: `DS${nowMs()}${rs.length}`, at: stamp(TODAY), status: 'OPEN' }, ...rs])
  const setReconStatus: Ctx['setReconStatus'] = (id, s) => setRecon((rs) => rs.map((r) => (r.id === id ? { ...r, status: s } : r)))
  const markRefundDone: Ctx['markRefundDone'] = (id) => setRefunds((rs) => rs.map((r) => (r.id === id ? { ...r, status: 'DONE' } : r)))

  const mine = (n: NotificationItem) => !!user && (n.to === 'ALL' || n.to === user.phone)
  const unreadCount = user ? notifications.filter((n) => mine(n) && !n.readBy.includes(user.phone)).length : 0
  const markRead: Ctx['markRead'] = (id) => user && setNotifs((ns) => ns.map((n) => (n.id === id && !n.readBy.includes(user.phone) ? { ...n, readBy: [...n.readBy, user.phone] } : n)))
  const markAllRead: Ctx['markAllRead'] = () => user && setNotifs((ns) => ns.map((n) => (mine(n) && !n.readBy.includes(user.phone) ? { ...n, readBy: [...n.readBy, user.phone] } : n)))

  const value: Ctx = {
    user, login, register, logout, identityTaken, customers,
    bookings, peekOrderId, createBooking, patchBooking, confirmPayment, checkIn, settleBooking, completeBooking, cancelBooking,
    blocker, lockAt, flagAffected, reassignBooking, closeByFacility, reassignLogs,
    courts, setCourts, staff, setStaff, promos, setPromos, locks, setLocks, holidays, setHolidays, branches, setBranches,
    transactions, reconciliations, addRecon, setReconStatus, refunds, markRefundDone,
    notifications, pushNotification, markRead, markAllRead, unreadCount,
    receipt, setReceipt, toast, resetDemo,
  }

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toast-host">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </AppCtx.Provider>
  )
}

