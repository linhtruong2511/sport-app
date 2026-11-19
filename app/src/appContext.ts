import { createContext, useContext, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  Booking, Branch, CancelCategory, Court, CustomerAccount, Holiday, Lock, NotificationItem, PaymentTx, Promo, ReassignLog,
  ReconciliationItem, RefundItem, Role, Staff,
} from './data'
import type { RefundResult } from './domain/refund'
import { nowMs } from './utils/format'

export interface AuthUser { role: Role; name: string; phone: string; email?: string; staffId?: string; branchId?: string; title: string }
export interface Toast { id: number; msg: string; kind: 'ok' | 'err' | 'info' }
export interface Result { ok: boolean; error?: string }

export interface NewBooking {
  id?: string; customer: string; phone: string; member: boolean; courtId: string; date: string; start: string; end: string
  subtotal: number; discount: number; total: number; depositAmount: number; unitPriceSnap: number
  payMode: 'deposit' | 'full'; method: 'qr' | 'cash'; source: 'online' | 'counter'; promo?: string
}
export interface PayInfo { amount: number; method: 'qr' | 'cash'; staffId?: string }
export interface Receipt { code: string; order: string; amount: number; method: string; cashier: string }
export interface Reassign { courtId: string; date: string; start: string; end: string }

export interface Ctx {
  user: AuthUser | null
  login: (identity: string, password: string) => Result
  register: (v: { name: string; phone: string; email: string; password: string }) => Result
  logout: () => void
  identityTaken: (phone: string, email: string, exceptStaffId?: string | null) => { phone?: 'staff' | 'customer' | 'owner'; email?: 'staff' | 'customer' | 'owner' }
  customers: CustomerAccount[]

  bookings: Booking[]
  peekOrderId: (date: string) => string
  createBooking: (b: NewBooking, status: 'pending' | 'confirmed', pay?: PayInfo) => Booking
  patchBooking: (id: string, p: Partial<Booking>) => void
  confirmPayment: (id: string, method?: 'qr' | 'cash') => boolean
  checkIn: (id: string) => Result
  settleBooking: (id: string, method: 'qr' | 'cash', staffId?: string) => Result
  completeBooking: (id: string) => void
  cancelBooking: (id: string, o: { reason: string; category: CancelCategory; by: Role }) => RefundResult | null
  blocker: (courtId: string, date: string, start: string, end: string, ignoreId?: string) => Booking | undefined
  lockAt: (courtId: string, date: string, start: string, end: string) => Lock | undefined
  flagAffected: (ids: string[], reason: string) => void
  reassignBooking: (id: string, to: Reassign) => void
  closeByFacility: (id: string, note: string) => void
  reassignLogs: ReassignLog[]

  courts: Court[]; setCourts: Dispatch<SetStateAction<Court[]>>
  staff: Staff[]; setStaff: Dispatch<SetStateAction<Staff[]>>
  promos: Promo[]; setPromos: Dispatch<SetStateAction<Promo[]>>
  locks: Lock[]; setLocks: Dispatch<SetStateAction<Lock[]>>
  holidays: Holiday[]; setHolidays: Dispatch<SetStateAction<Holiday[]>>
  branches: Branch[]; setBranches: Dispatch<SetStateAction<Branch[]>>

  transactions: PaymentTx[]
  reconciliations: ReconciliationItem[]
  addRecon: (r: Omit<ReconciliationItem, 'id' | 'at' | 'status'>) => void
  setReconStatus: (id: string, s: ReconciliationItem['status']) => void
  refunds: RefundItem[]
  markRefundDone: (id: string) => void

  notifications: NotificationItem[]
  pushNotification: (n: Omit<NotificationItem, 'id' | 'at' | 'readBy'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  unreadCount: number

  receipt: Receipt | null
  setReceipt: (r: Receipt | null) => void
  toast: (msg: string, kind?: Toast['kind']) => void
  resetDemo: () => void
}

export const AppCtx = createContext<Ctx | null>(null)
export const useApp = () => {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp must be used inside AppProvider')
  return c
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(nowMs)
  useEffect(() => {
    const t = setInterval(() => setNow(nowMs()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}
