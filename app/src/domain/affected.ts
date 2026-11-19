// Quét đơn đặt sân bị ảnh hưởng khi Chủ sân đổi lịch vận hành (UC 019 / 020 / 021)
import type { Booking, Court, DayHours } from '../data'
import { dayIndex, mins } from '../utils/format'

const OPEN_STATUS = ['pending', 'confirmed', 'overdue']
const isOpen = (b: Booking) => OPEN_STATUS.includes(b.status)

/** Đơn chưa hoàn tất của sân trùng khoảng khóa [from, to) (dạng YYYY-MM-DDTHH:mm). */
export const affectedByLock = (bs: Booking[], courtId: string, from: string, to: string) =>
  bs.filter((b) => isOpen(b) && b.courtId === courtId && `${b.date}T${b.start}` < to && `${b.date}T${b.end === '24:00' ? '23:59' : b.end}` > from)

/** Đơn chưa hoàn tất rơi vào khoảng ngày nghỉ (toàn hệ thống hoặc theo chi nhánh). */
export const affectedByHoliday = (bs: Booking[], courts: Court[], date: string, endDate: string, branchId?: string) =>
  bs.filter((b) => isOpen(b) && b.date >= date && b.date <= endDate && (!branchId || courts.find((c) => c.id === b.courtId)?.branchId === branchId))

/** Đơn chưa hoàn tất nằm ngoài giờ mở cửa mới của chi nhánh. */
export const affectedByHours = (bs: Booking[], courts: Court[], branchId: string, hours: DayHours[], fromDate: string) =>
  bs.filter((b) => {
    if (!isOpen(b) || b.date < fromDate || courts.find((c) => c.id === b.courtId)?.branchId !== branchId) return false
    const h = hours[dayIndex(b.date)]
    return h.closed || mins(b.start) < mins(h.open) || mins(b.end) > mins(h.close)
  })

/** Đơn tương lai còn hiệu lực của một sân (chặn đổi chi nhánh – UC 018 Alt 2b). */
export const openBookingsOfCourt = (bs: Booking[], courtId: string, fromDate: string) =>
  bs.filter((b) => b.courtId === courtId && b.date >= fromDate && ['pending', 'confirmed', 'overdue', 'playing'].includes(b.status))
