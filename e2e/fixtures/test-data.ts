export type UserRole = 'customer' | 'staff' | 'owner';

export const ACCOUNTS = {
  customer: {
    role: 'customer' as const,
    roleLabel: 'Khách hàng',
    phone: '0912345678',
    seedBookingPhone: '0987654321',
    email: 'khachhang@sporthub.vn',
    password: 'Matkhau123',
    name: 'Nguyễn Văn An',
  },
  staffCs1: {
    role: 'staff' as const,
    roleLabel: 'Nhân viên thu ngân',
    phone: '0933445566',
    email: 'hunglv@sporthub.vn',
    password: 'Nv123456',
    name: 'Lê Văn Hùng',
    branchId: 'cs1',
    branchName: 'Cơ sở 1 - Cầu Giấy',
  },
  staffCs2: {
    role: 'staff' as const,
    roleLabel: 'Nhân viên thu ngân',
    phone: '0944556677',
    email: 'maint@sporthub.vn',
    password: 'Nv123456',
    name: 'Nguyễn Thị Mai',
    branchId: 'cs2',
    branchName: 'Cơ sở 2 - Mỹ Đình',
  },
  staffLocked: {
    role: 'staff' as const,
    roleLabel: 'Nhân viên thu ngân',
    phone: '0911223344',
    email: 'viethq@sporthub.vn',
    password: 'Nv123456',
    name: 'Hoàng Quốc Việt',
  },
  owner: {
    role: 'owner' as const,
    roleLabel: 'Chủ hệ thống sân',
    phone: '0900000001',
    email: 'chu@sporthub.vn',
    password: 'Chu123456',
    name: 'Đặng Quốc Bảo',
  },
};

export const DEMO_DATES = {
  today: '2026-11-12',
  tomorrow: '2026-11-13',
  inThreeDays: '2026-11-15', // 2 đến < 5 ngày -> hoàn 50% phần ngoài cọc
  inSixDays: '2026-11-18', // >= 5 ngày -> hoàn 100% phần ngoài cọc
  holiday: '2026-12-25',
  customHoliday: '2026-11-20',
  emptyMonthFrom: '2026-12-01',
  emptyMonthTo: '2026-12-31',
};

export const SEED_BOOKINGS = {
  customerConfirmed: 'BK2026111001',
  customerPending: 'BK2026111008',
  customerCompleted: 'BK2026110502',
  customerCancelled: 'BK2026110209',
  otherCustomerPending: 'BK2026111014',
  staffPlaying: 'BK2026111002',
  staffOverdue: 'BK2026111005',
  staffPaidFullConfirmed: 'BK2026111004',
  staffSameCourtAsPlaying: 'BK2026111021',
};

export const PROMOS = {
  morning20: 'SANGVUI20',
  member10: 'TRIAN10',
  noon15: 'SALEGIOVANG20',
  counter15: 'QUAYCG15',
};
