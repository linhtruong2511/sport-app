export type UserRole = 'customer' | 'staff' | 'owner';

/**
 * Tài khoản seed thật trong database/sporthub_init.sql (SportHub_Test).
 */
export const ACCOUNTS = {
  customer: {
    role: 'customer' as const,
    roleLabel: 'Hội viên',
    phone: '0987654321',
    email: 'nguyenvanan@gmail.com',
    password: 'An123456',
    name: 'Nguyễn Văn An',
  },
  customer2: {
    role: 'customer' as const,
    roleLabel: 'Hội viên',
    phone: '0912345678',
    email: 'khachhang@gmail.com',
    password: 'An123456',
    name: 'Trần Thị Bình',
  },
  staffCs1: {
    role: 'staff' as const,
    roleLabel: 'Nhân viên thu ngân',
    phone: '0933445577',
    email: 'trangpt@sporthub.vn',
    password: 'Nv123456',
    name: 'Phạm Thu Trang',
    branchCode: 'CS01',
    branchName: 'Cơ sở 1 - Cầu Giấy',
  },
  staffCs2: {
    role: 'staff' as const,
    roleLabel: 'Nhân viên thu ngân',
    phone: '0933445566',
    email: 'hunglv@sanbong.vn',
    password: 'Nv123456',
    name: 'Lê Văn Hùng',
    branchCode: 'CS02',
    branchName: 'Cơ sở 2 - Mỹ Đình',
  },
  staffLocked: {
    role: 'staff' as const,
    roleLabel: 'Nhân viên thu ngân',
    phone: '0933445588',
    email: null,
    password: 'Nv123456',
    name: 'Đỗ Minh Tuấn',
  },
  owner: {
    role: 'owner' as const,
    roleLabel: 'Chủ hệ thống sân',
    phone: '0900000001',
    email: 'owner@sporthub.vn',
    password: 'Owner@123',
    name: 'Chủ sân SportHub',
  },
};

export const PROMOS = {
  morning20: 'SANGVUI20',
  memberSpecific: 'TRIAN10',
  pausedPickle: 'PICKLECS01',
};
