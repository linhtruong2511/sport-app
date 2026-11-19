// ===== Kiểu dữ liệu & dữ liệu mẫu cho SportHub (Prototype, không Backend) =====
import { addDays, mins } from './utils/format'

export { fmt, vnd, money, kfmt, toVN, hh, mins, dow } from './utils/format'

export type Role = 'customer' | 'staff' | 'owner'
export type SportKey = 'pickleball' | 'football' | 'badminton' | 'tennis' | 'basketball'

export interface Sport { key: SportKey; label: string; emoji: string; code: string; detail: string }
export const SPORTS: Sport[] = [
  { key: 'pickleball', label: 'Pickleball', emoji: '🎾', code: 'PK', detail: 'Pickleball (Mái che)' },
  { key: 'football', label: 'Bóng đá Mini', emoji: '⚽', code: 'BD', detail: 'Bóng đá (Sân 7 người)' },
  { key: 'badminton', label: 'Cầu lông', emoji: '🏸', code: 'CL', detail: 'Cầu lông (Thảm PVC)' },
  { key: 'tennis', label: 'Tennis', emoji: '🎾', code: 'TN', detail: 'Tennis (Ngoài trời)' },
  { key: 'basketball', label: 'Bóng rổ', emoji: '🏀', code: 'BR', detail: 'Bóng rổ (Ngoài trời)' },
]
export const sportOf = (k: SportKey) => SPORTS.find((s) => s.key === k)!

// ===== Quy tắc nghiệp vụ đã chốt (Thiết kế chi tiết, Mục 1.5) =====
export const HOLD_MINUTES = 10 // D2
export const NO_SHOW_GRACE_MINUTES = 30 // D3
export const MAX_FAILED_LOGINS = 5 // D9
export const LOCK_MINUTES = 5 // D9

// ===== Thời gian demo =====
export const TODAY = '2026-11-12' // ngày demo khớp thiết kế (Thứ Năm, 12/11/2026)
export const DEMO_NOW_TIME = '17:00' // giờ demo cố định dùng để tính hoàn tiền / quá giờ nhận sân
export const DEMO_NOW_ISO = `${TODAY}T${DEMO_NOW_TIME}:00`

// Khung giờ gợi ý ở Trang chủ (giờ bắt đầu từ → đến)
export const FRAMES = [
  { label: 'Buổi sáng (05:00 - 11:00)', from: 5, to: 11 },
  { label: 'Buổi trưa (11:00 - 15:00)', from: 11, to: 15 },
  { label: 'Buổi chiều (15:00 - 17:30)', from: 15, to: 18 },
  { label: 'Buổi tối (17:30 - 22:00)', from: 18, to: 23 },
]

// ===== Chi nhánh =====
export interface DayHours { open: string; close: string; closed: boolean }
export interface Branch {
  id: string; name: string; short: string; address: string; phone: string; tone: 'green' | 'sky' | 'indigo'
  bankName: string; bankAccNo: string; bankAccName: string
  hours: DayHours[] // chỉ số theo getDay(): 0 = Chủ nhật … 6 = Thứ bảy
}
const week = (open: string, close: string): DayHours[] => Array.from({ length: 7 }, () => ({ open, close, closed: false }))
export const BRANCHES: Branch[] = [
  { id: 'cs1', name: 'Cơ sở 1 - Cầu Giấy', short: 'Cầu Giấy', address: '128 Nguyễn Phong Sắc, Quận Cầu Giấy, Hà Nội', phone: '0243 888 1111', tone: 'green', bankName: 'Vietcombank', bankAccNo: '1029384756', bankAccName: 'SPORTHUB CAU GIAY', hours: week('05:00', '23:00') },
  { id: 'cs2', name: 'Cơ sở 2 - Mỹ Đình', short: 'Mỹ Đình', address: 'Khu đô thị Mỹ Đình II, Nam Từ Liêm, Hà Nội', phone: '0243 888 2222', tone: 'sky', bankName: 'MB Bank', bankAccNo: '0382910475', bankAccName: 'SPORTHUB MY DINH', hours: week('05:30', '22:30') },
  { id: 'cs3', name: 'Cơ sở 3 - Thanh Xuân', short: 'Thanh Xuân', address: '88 Lê Văn Lương, Quận Thanh Xuân, Hà Nội', phone: '0243 888 3333', tone: 'indigo', bankName: 'Techcombank', bankAccNo: '19036284751', bankAccName: 'SPORTHUB THANH XUAN', hours: week('05:00', '23:00') },
]
export const branchOf = (id: string) => BRANCHES.find((b) => b.id === id)!

// ===== Sân =====
export interface PriceRule { label: string; start: string; end: string; price: number }
export interface Court {
  id: string // mã sân, vd SAN_PK_01
  name: string
  branchId: string
  sport: SportKey
  description: string
  depositType: 'percent' | 'fixed'
  deposit: number // % (10–100) hoặc số tiền cố định (VNĐ) tùy depositType
  priceRules: PriceRule[]
  active: boolean
}

export const makeRules = (normal: number, peak: number): PriceRule[] => [
  { label: 'Giờ thường', start: '05:00', end: '16:00', price: normal },
  { label: 'Cao điểm', start: '16:00', end: '21:00', price: peak },
  { label: 'Giờ muộn', start: '21:00', end: '24:00', price: Math.round((peak * 0.8) / 1000) * 1000 },
]

const PRICES: Record<SportKey, [number, number]> = {
  pickleball: [150000, 250000], football: [300000, 600000], badminton: [100000, 160000],
  tennis: [200000, 350000], basketball: [200000, 350000],
}
const LAYOUT: { branch: string; items: [SportKey, number][] }[] = [
  { branch: 'cs1', items: [['pickleball', 3], ['badminton', 3], ['football', 2]] },
  { branch: 'cs2', items: [['badminton', 5], ['pickleball', 3], ['football', 2]] },
  { branch: 'cs3', items: [['tennis', 2], ['basketball', 2], ['pickleball', 2]] },
]
export function buildCourts(): Court[] {
  const counter: Record<string, number> = {}
  const out: Court[] = []
  for (const b of LAYOUT) {
    for (const [sport, n] of b.items) {
      const sp = sportOf(sport)
      for (let i = 1; i <= n; i++) {
        counter[sport] = (counter[sport] ?? 0) + 1
        const [pn, pp0] = PRICES[sport]
        const pp = sport === 'badminton' && b.branch === 'cs1' ? 150000 : pp0
        out.push({
          id: `SAN_${sp.code}_${String(counter[sport]).padStart(2, '0')}`,
          name: `Sân ${sp.label} ${String(i).padStart(2, '0')}`,
          branchId: b.branch, sport, description: sp.detail, depositType: 'percent', deposit: 30,
          priceRules: makeRules(pn, pp), active: true,
        })
      }
    }
  }
  return out
}

// ===== Khuyến mãi =====
export type PromoStatus = 'active' | 'paused' | 'discontinued'
export interface Promo {
  code: string; name: string
  discountType: 'percent' | 'fixed'
  percent: number; fixedOff: number; maxOff: number | null
  fromHour: number; toHour: number // khung giờ bắt đầu áp dụng
  scope: string; start: string; end: string; limit: number; used: number
  status: PromoStatus; notified: boolean; counterOnly?: boolean
  sports?: SportKey[]; branchId?: string
  targetAudience: 'all' | 'specific'; targetPhones: string[]
  tag: string; tone: 'green' | 'sky' | 'amber'
}
export const PROMOS_SEED: Promo[] = [
  { code: 'SANGVUI20', name: 'Ưu đãi khung giờ vàng buổi sáng', discountType: 'percent', percent: 20, fixedOff: 0, maxOff: 100000, fromHour: 6, toHour: 11, scope: 'Tất cả cơ sở', start: '2026-11-01', end: '2026-11-30', limit: 200, used: 84, status: 'active', notified: true, targetAudience: 'all', targetPhones: [], tag: 'Khung giờ vàng buổi sáng', tone: 'green' },
  { code: 'TRIAN10', name: 'Tri ân khách hàng thân thiết tháng 11', discountType: 'percent', percent: 10, fixedOff: 0, maxOff: null, fromHour: 0, toHour: 24, scope: 'Tất cả cơ sở', start: '2026-11-01', end: '2026-11-30', limit: 300, used: 102, status: 'active', notified: true, targetAudience: 'all', targetPhones: [], tag: 'Quà tặng hội viên', tone: 'sky' },
  { code: 'SALEGIOVANG20', name: 'Giờ thấp điểm buổi trưa', discountType: 'percent', percent: 15, fixedOff: 0, maxOff: null, fromHour: 10, toHour: 15, scope: 'Sân Pickleball & Cầu lông trong nhà', start: '2026-11-01', end: '2026-11-30', limit: 150, used: 37, status: 'active', notified: false, sports: ['pickleball', 'badminton'], targetAudience: 'all', targetPhones: [], tag: 'Giờ thấp điểm buổi trưa', tone: 'amber' },
  { code: 'QUAYCG15', name: 'Ưu đãi tại quầy Cầu Giấy', discountType: 'percent', percent: 15, fixedOff: 0, maxOff: null, fromHour: 0, toHour: 24, scope: 'Tại quầy Cầu Giấy', start: '2026-11-01', end: '2026-12-31', limit: 9999, used: 12, status: 'active', notified: false, counterOnly: true, branchId: 'cs1', targetAudience: 'all', targetPhones: [], tag: 'Tại quầy', tone: 'green' },
]

// ===== Đơn đặt sân =====
export type BookingStatus = 'pending' | 'confirmed' | 'playing' | 'overdue' | 'completed' | 'cancelled' | 'expired'
export type CancelCategory = 'customer' | 'noshow' | 'facility'
export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Chờ thanh toán', confirmed: 'Đã xác nhận', playing: 'Đang sử dụng', overdue: 'Quá giờ nhận sân',
  completed: 'Hoàn thành', cancelled: 'Đã hủy', expired: 'Quá hạn thanh toán',
}
export interface HistoryItem { at: string; text: string }
export interface Booking {
  id: string; customer: string; phone: string; member: boolean
  courtId: string; date: string; start: string; end: string
  subtotal: number; discount: number; total: number; paid: number
  depositAmount: number // snapshot tại thời điểm đặt (UC 018)
  unitPriceSnap: number // đơn giá bình quân/giờ tại thời điểm đặt
  payMode: 'deposit' | 'full'; method: 'qr' | 'cash'; source: 'online' | 'counter'
  status: BookingStatus; promo?: string
  holdUntil?: number; createdAt: string
  cancelReason?: string; cancelledAt?: string; cancelCategory?: CancelCategory
  keptDeposit?: number; refundRate?: number; refundAmount?: number
  checkedInAt?: string; completedAt?: string
  isAffected?: boolean; affectedReason?: string
  label?: string // nhãn hiển thị cho khách khác trên bảng lịch
  history: HistoryItem[]
}
export const remaining = (b: Booking) => (b.status === 'cancelled' || b.status === 'expired' ? 0 : Math.max(0, b.total - b.paid))
/** Tiền thực thu giữ lại của đơn (sau hoàn tiền); đơn đóng do cơ sở không tính. */
export const retainedOf = (b: Booking) => {
  if (b.status === 'pending' || b.status === 'expired') return 0
  if (b.status === 'cancelled') return b.cancelCategory === 'facility' ? 0 : (b.keptDeposit ?? 0)
  return b.paid
}

// ===== Tài khoản =====
export interface CustomerAccount { phone: string; aliases?: string[]; email: string; name: string; password: string; title: string }
export const CUSTOMERS_SEED: CustomerAccount[] = [
  { phone: '0987654321', aliases: ['0912345678'], email: 'khachhang@sporthub.vn', name: 'Nguyễn Văn An', password: 'Matkhau123', title: 'Hội viên thân thiết' },
  { phone: '0918223344', email: 'khanhpq@gmail.com', name: 'Phạm Quốc Khánh', password: 'Matkhau123', title: 'Hội viên' },
  { phone: '0977889900', email: 'damvd@gmail.com', name: 'Vũ Đức Đam', password: 'Matkhau123', title: 'Hội viên' },
  { phone: '0912998877', email: 'tunght@gmail.com', name: 'Hoàng Thanh Tùng', password: 'Matkhau123', title: 'Hội viên' },
  { phone: '0988776655', email: 'halt@gmail.com', name: 'Lê Thu Hà', password: 'Matkhau123', title: 'Hội viên' },
]
export const OWNER = { phone: '0900000001', email: 'chu@sporthub.vn', password: 'Chu123456', name: 'Đặng Quốc Bảo', title: 'Chủ hệ thống sân' }

export interface Staff { id: string; name: string; phone: string; email: string; branchId: string; locked: boolean; password: string; orders: number; revenue: number; archived?: number }
export const STAFF_SEED: Staff[] = [
  { id: 'NV001', name: 'Lê Văn Hùng', phone: '0933445566', email: 'hunglv@sporthub.vn', branchId: 'cs1', locked: false, password: 'Nv123456', orders: 142, revenue: 48500000 },
  { id: 'NV002', name: 'Nguyễn Thị Mai', phone: '0944556677', email: 'maint@sporthub.vn', branchId: 'cs2', locked: false, password: 'Nv123456', orders: 98, revenue: 31200000 },
  { id: 'NV003', name: 'Phạm Văn Tuấn', phone: '0966778899', email: 'tuanpv@sporthub.vn', branchId: 'cs3', locked: false, password: 'Nv123456', orders: 76, revenue: 24900000 },
  { id: 'NV004', name: 'Hoàng Quốc Việt', phone: '0911223344', email: 'viethq@sporthub.vn', branchId: 'cs1', locked: true, password: 'Nv123456', orders: 64, revenue: 19800000, archived: 64 },
]

// ===== Giao dịch, đối soát, hoàn tiền, thông báo =====
export interface PaymentTx {
  id: string; bookingId: string; amount: number; method: 'qr' | 'cash'
  kind: 'DEPOSIT' | 'FULL' | 'SETTLEMENT'; staffId?: string; at: string
}
export interface ReconciliationItem {
  id: string; bookingId?: string; reason: 'WRONG_AMOUNT' | 'WRONG_CONTENT' | 'LATE'
  amount: number; expected: number; content: string; bank: string; at: string
  status: 'OPEN' | 'MATCHED' | 'REFUNDED' | 'IGNORED'
}
export interface RefundItem {
  id: string; bookingId: string; customer: string; phone: string; amount: number; rate: number
  status: 'PENDING' | 'DONE'; at: string; note?: string
}
export type NotifType = 'PROMO' | 'REMINDER' | 'PAYMENT' | 'REASSIGN' | 'CANCEL'
export interface NotificationItem {
  id: string; to: string // 'ALL' hoặc số điện thoại khách
  type: NotifType; title: string; body: string; at: string; readBy: string[]
  promoCode?: string; bookingId?: string
}
export interface ReassignLog { id: string; bookingId: string; text: string; at: string; by: string }

// ===== Khóa bảo trì & ngày nghỉ =====
export interface Lock { id: string; courtId: string; from: string; to: string; reason: string; mode: 'temp' | 'stop' } // from/to dạng 'YYYY-MM-DDTHH:mm'
export const LOCKS_SEED: Lock[] = [{ id: 'L1', courtId: 'SAN_PK_02', from: '2026-11-12T14:00', to: '2026-11-14T18:00', reason: 'Bảo trì mặt sân & thay lưới', mode: 'temp' }]
export interface Holiday { id: string; date: string; endDate: string; note: string; branchId?: string }
export const HOLIDAYS_SEED: Holiday[] = [{ id: 'H1', date: '2026-12-25', endDate: '2026-12-25', note: 'Nghỉ lễ Giáng sinh (đóng cửa)' }]

// ===== Dữ liệu mẫu đơn đặt sân =====
const stampOf = (date: string, time: string) => `${time} ngày ${date.split('-').reverse().join('/')}`

export function bookingsSeed(now: number): Booking[] {
  const mk = (b: Partial<Booking> & Pick<Booking, 'id' | 'customer' | 'phone' | 'courtId' | 'date' | 'start' | 'end' | 'total' | 'paid' | 'status'>): Booking => {
    const hours = (mins(b.end) - mins(b.start)) / 60 || 1
    const payMode = b.payMode ?? (b.paid >= b.total ? 'full' : 'deposit')
    const base: Booking = {
      member: true, subtotal: b.total, discount: 0, method: 'qr', source: 'online',
      depositAmount: payMode === 'deposit' ? Math.max(b.paid, Math.round(b.total * 0.3)) : Math.round(b.total * 0.3),
      unitPriceSnap: Math.round(b.total / hours), payMode,
      createdAt: stampOf(addDays(b.date, -2), '09:15'), history: [], ...b,
    }
    const h: HistoryItem[] = [{ at: base.createdAt, text: 'Khách tạo đơn đặt sân (Chờ thanh toán).' }]
    if (b.paid > 0 || b.status === 'confirmed' || b.status === 'playing' || b.status === 'completed') h.push({ at: base.createdAt, text: base.payMode === 'full' || b.paid >= b.total ? 'Đã thanh toán đủ — Đơn được xác nhận.' : 'Đã đặt cọc — Đơn được xác nhận.' })
    if (b.status === 'playing') h.push({ at: stampOf(b.date, b.start), text: 'Khách nhận sân (Đang sử dụng).' })
    if (b.status === 'completed') h.push({ at: stampOf(b.date, b.end), text: 'Kết thúc lượt chơi (Hoàn thành).' })
    if (b.status === 'overdue') h.push({ at: stampOf(b.date, '16:30'), text: 'Quá 30 phút chưa đến nhận sân.' })
    if (b.status === 'cancelled') h.push({ at: b.cancelledAt ?? base.createdAt, text: `Đơn bị hủy. Lý do: ${b.cancelReason ?? '—'}` })
    return { ...base, history: b.history ?? h }
  }
  const A = '0987654321'
  const seeds: Booking[] = [
    mk({ id: 'BK2026111001', customer: 'Nguyễn Văn An', phone: A, courtId: 'SAN_PK_01', date: TODAY, start: '18:00', end: '20:00', subtotal: 500000, discount: 50000, total: 450000, paid: 135000, status: 'confirmed', promo: 'TRIAN10', depositAmount: 135000 }),
    mk({ id: 'BK2026111008', customer: 'Nguyễn Văn An', phone: A, courtId: 'SAN_CL_05', date: '2026-11-14', start: '19:00', end: '21:00', total: 300000, paid: 0, status: 'pending', holdUntil: now + 6 * 60000 + 12000, payMode: 'deposit', depositAmount: 90000 }),
    mk({ id: 'BK2026110502', customer: 'Nguyễn Văn An', phone: A, courtId: 'SAN_BD_01', date: '2026-11-05', start: '17:30', end: '19:00', total: 900000, paid: 900000, status: 'completed', depositAmount: 270000 }),
    mk({ id: 'BK2026110209', customer: 'Nguyễn Văn An', phone: A, courtId: 'SAN_TN_01', date: '2026-11-02', start: '16:00', end: '18:00', total: 400000, paid: 120000, status: 'cancelled', cancelReason: 'Bận công việc đột xuất không thể tham gia', cancelledAt: '14:20 ngày 02/11/2026', cancelCategory: 'customer', keptDeposit: 120000, refundRate: 0, refundAmount: 0, depositAmount: 120000 }),
    mk({ id: 'BK2026111004', customer: 'Phạm Quốc Khánh', phone: '0918223344', courtId: 'SAN_CL_02', date: TODAY, start: '19:00', end: '21:00', total: 300000, paid: 300000, status: 'confirmed' }),
    mk({ id: 'BK2026111002', customer: 'Trần Minh Hoàng', phone: '0905112233', member: false, courtId: 'SAN_CL_01', date: TODAY, start: '08:00', end: '10:00', total: 255000, paid: 255000, status: 'playing', source: 'counter', method: 'cash', checkedInAt: '08:00 ngày 12/11/2026' }),
    mk({ id: 'BK2026111005', customer: 'Vũ Đức Đam', phone: '0977889900', courtId: 'SAN_BD_02', date: TODAY, start: '16:00', end: '17:30', total: 600000, paid: 180000, status: 'overdue', depositAmount: 180000 }),
    mk({ id: 'BK2026111019', customer: 'Hoàng Thanh Tùng', phone: '0912998877', courtId: 'SAN_CL_03', date: TODAY, start: '19:00', end: '21:00', total: 400000, paid: 120000, status: 'confirmed', depositAmount: 120000 }),
    mk({ id: 'BK2026111021', customer: 'Lê Thu Hà', phone: '0988776655', courtId: 'SAN_CL_01', date: TODAY, start: '19:00', end: '21:00', total: 300000, paid: 300000, status: 'confirmed' }),
    mk({ id: 'BK2026111011', customer: 'CLB Cầu Giấy', phone: '0911000111', courtId: 'SAN_PK_01', date: TODAY, start: '08:00', end: '10:00', total: 300000, paid: 300000, status: 'confirmed', label: 'CLB Cầu Giấy' }),
    mk({ id: 'BK2026111012', customer: 'Đỗ Hải Nam', phone: '0933111222', courtId: 'SAN_PK_01', date: TODAY, start: '16:00', end: '18:00', total: 500000, paid: 500000, status: 'confirmed' }),
    mk({ id: 'BK2026111013', customer: 'Ngô Bảo Châu', phone: '0933222333', courtId: 'SAN_PK_03', date: TODAY, start: '06:00', end: '08:00', total: 300000, paid: 300000, status: 'confirmed' }),
    mk({ id: 'BK2026111014', customer: 'Bùi Anh Tuấn', phone: '0933444555', courtId: 'SAN_PK_03', date: TODAY, start: '20:00', end: '22:00', total: 500000, paid: 0, status: 'pending', holdUntil: now + 9 * 60000, payMode: 'deposit', depositAmount: 150000 }),
  ]
  // Lịch sử các ngày trước đó (phục vụ báo cáo doanh thu động theo kỳ)
  const past: [string, string, string, string, string, number, 'completed' | 'cancelled' | 'expired', CancelCategory?][] = [
    ['2026-11-03', 'SAN_PK_01', '06:00', '08:00', 'Mai Văn Long', 300000, 'completed'],
    ['2026-11-03', 'SAN_CL_02', '18:00', '20:00', 'Phan Thu Trang', 300000, 'completed'],
    ['2026-11-04', 'SAN_BD_01', '18:00', '20:00', 'Đinh Công Sơn', 1200000, 'completed'],
    ['2026-11-06', 'SAN_CL_05', '19:00', '21:00', 'Lý Gia Bảo', 320000, 'completed'],
    ['2026-11-06', 'SAN_CL_06', '08:00', '10:00', 'Trương Mỹ Linh', 200000, 'completed'],
    ['2026-11-07', 'SAN_PK_04', '16:00', '18:00', 'Cao Thế Anh', 500000, 'completed'],
    ['2026-11-07', 'SAN_BD_03', '19:00', '21:00', 'Hồ Đắc Thắng', 1200000, 'completed'],
    ['2026-11-08', 'SAN_TN_01', '17:00', '19:00', 'Võ Thanh Hải', 700000, 'completed'],
    ['2026-11-08', 'SAN_BR_01', '18:00', '20:00', 'Tạ Quang Vinh', 700000, 'completed'],
    ['2026-11-09', 'SAN_PK_07', '06:00', '08:00', 'Dương Khánh Ly', 300000, 'completed'],
    ['2026-11-09', 'SAN_CL_03', '20:00', '22:00', 'Kiều Minh Đức', 300000, 'completed'],
    ['2026-11-10', 'SAN_PK_02', '18:00', '20:00', 'Lâm Tuấn Kiệt', 500000, 'cancelled', 'customer'],
    ['2026-11-10', 'SAN_CL_04', '19:00', '21:00', 'Nguyễn Hà My', 320000, 'cancelled', 'noshow'],
    ['2026-11-11', 'SAN_PK_05', '16:00', '18:00', 'Bạch Quốc Huy', 500000, 'completed'],
    ['2026-11-11', 'SAN_TN_02', '06:00', '08:00', 'Hà Thu Phương', 400000, 'completed'],
    ['2026-11-11', 'SAN_CL_01', '18:00', '20:00', 'Trịnh Văn Nghĩa', 300000, 'expired'],
  ]
  past.forEach(([date, courtId, start, end, customer, total, status, cat], i) => {
    const day = date.slice(8)
    const dep = Math.round(total * 0.3)
    const cancelled = status === 'cancelled'
    seeds.push(mk({
      id: `BK202611${day}${String(40 + i)}`, customer, phone: `09${String(10000000 + i * 137).padStart(8, '0')}`, member: false, courtId, date, start, end, total,
      paid: status === 'expired' ? 0 : cancelled ? dep : total, status, payMode: cancelled || i % 3 === 0 ? 'deposit' : 'full',
      source: i % 4 === 0 ? 'counter' : 'online', method: i % 4 === 0 ? 'cash' : 'qr', depositAmount: dep,
      ...(cancelled ? { cancelCategory: cat, cancelReason: cat === 'noshow' ? 'Khách không đến nhận sân' : 'Khách báo hủy sát giờ', cancelledAt: stampOf(date, '12:00'), keptDeposit: dep, refundRate: 0, refundAmount: 0 } : {}),
    }))
  })
  // Với đơn quá khứ trả đủ nhưng chọn kiểu cọc: bảo đảm paid >= total khi completed
  return seeds.map((b) => (b.status === 'completed' && b.paid < b.total ? { ...b, paid: b.total, payMode: 'full' } : b))
}

export function txSeed(bs: Booking[]): PaymentTx[] {
  return bs.filter((b) => b.paid > 0).map((b, i) => ({
    id: `GD${String(1000 + i)}`, bookingId: b.id, amount: b.paid, method: b.method,
    kind: b.paid >= b.total ? 'FULL' : 'DEPOSIT', staffId: b.source === 'counter' ? 'NV001' : undefined, at: b.createdAt,
  }))
}

export const NOTIFS_SEED: NotificationItem[] = [
  { id: 'N1', to: '0987654321', type: 'REMINDER', title: '⏰ Nhắc lịch chơi sắp bắt đầu', body: 'Chỉ còn 1 tiếng nữa là tới giờ chơi của bạn (18:00 - 20:00 hôm nay) tại Sân Pickleball 01 - Cơ sở 1 Cầu Giấy. Số tiền còn lại cần thanh toán tại quầy: 315.000 VNĐ.', at: '17:00 ngày 12/11/2026', readBy: [], bookingId: 'BK2026111001' },
  { id: 'N2', to: 'ALL', type: 'PROMO', title: '🎁 Giảm 20% khung giờ vàng buổi sáng', body: 'Nhập mã SANGVUI20 để được giảm ngay 20% (tối đa 100.000đ) khi đặt sân từ 06:00 – 11:00 tại mọi chi nhánh.', at: '11/11/2026', readBy: [], promoCode: 'SANGVUI20' },
  { id: 'N3', to: 'ALL', type: 'PROMO', title: '🎉 Ưu đãi tri ân hội viên tháng 11', body: 'Cảm ơn bạn đã đồng hành cùng SportHub! Dùng mã TRIAN10 để giảm 10% cho mọi khung giờ đặt trực tuyến.', at: '01/11/2026', readBy: [], promoCode: 'TRIAN10' },
]

export const RECON_SEED: ReconciliationItem[] = [
  { id: 'DS1', bookingId: 'BK2026111008', reason: 'WRONG_AMOUNT', amount: 60000, expected: 90000, content: 'THANHTOAN BK2026111008', bank: 'Vietcombank • FT26111211', at: '10:42 ngày 12/11/2026', status: 'OPEN' },
  { id: 'DS2', reason: 'WRONG_CONTENT', amount: 150000, expected: 0, content: 'chuyen tien san', bank: 'MB Bank • FT26111187', at: '09:05 ngày 12/11/2026', status: 'OPEN' },
]
