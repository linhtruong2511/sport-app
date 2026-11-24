/**
 * Dữ liệu mẫu — tính tương đối theo ngày hiện tại để lúc nào mở app cũng có
 * đơn hôm nay / ngày mai / quá khứ, đơn chờ thanh toán, đơn bị ảnh hưởng, giao dịch cần đối soát...
 *
 * Tài khoản demo (mật khẩu chung 123456):
 *   Chủ sân   0901000001 / owner@sporthub.vn
 *   Nhân viên 0933445566 / hunglv@sporthub.vn (Cơ sở 1)
 *   Khách     0987654321 / khachhang@sporthub.vn
 */
import type { AmountType, Booking, Branch, Court, DbState, OpeningHour, PriceRule, Promotion, Sport, User } from './types';
import { setDb } from './store';
import { applyBankTransfer, cancelBooking, checkIn, complete, createBooking, createPaymentRequest, recordPayment } from '../lib/ops';
import { addDays, addMinutes, at, ms, nowIso, nowMs, today } from '../lib/time';
import { remainingOf } from '../lib/mappers';
import { runJobs } from '../jobs';
import { setPublishMuted } from '../realtime';

const week = (open: string, close: string, sunday?: [string, string]): OpeningHour[] =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    dayOfWeek: d,
    openTime: d === 7 && sunday ? sunday[0] : open,
    closeTime: d === 7 && sunday ? sunday[1] : close,
    isClosed: false,
  }));

type RuleSpec = [label: string, start: string, end: string, price: number];

const PRICE: Record<string, { rules: RuleSpec[]; deposit: [AmountType, number]; type: string; desc: string }> = {
  PICKLEBALL: {
    rules: [
      ['Giờ thường', '05:00', '16:00', 150_000],
      ['Cao điểm', '16:00', '21:00', 250_000],
      ['Giờ muộn', '21:00', '24:00', 200_000],
    ],
    deposit: ['PERCENT', 30],
    type: 'Sân tiêu chuẩn',
    desc: 'Pickleball (Mái che)',
  },
  BADMINTON: {
    rules: [
      ['Giờ thường', '05:00', '17:00', 100_000],
      ['Cao điểm', '17:00', '24:00', 150_000],
    ],
    deposit: ['FIXED', 50_000],
    type: 'Sân thảm PVC',
    desc: 'Cầu lông trong nhà, thảm tiêu chuẩn BWF',
  },
  FOOTBALL: {
    rules: [
      ['Giờ thường', '05:00', '16:00', 300_000],
      ['Cao điểm', '16:00', '24:00', 450_000],
    ],
    deposit: ['PERCENT', 30],
    type: 'Sân 7 người',
    desc: 'Cỏ nhân tạo, có đèn chiếu sáng',
  },
  TENNIS: {
    rules: [
      ['Giờ thường', '05:00', '16:00', 200_000],
      ['Cao điểm', '16:00', '24:00', 300_000],
    ],
    deposit: ['PERCENT', 30],
    type: 'Sân cứng',
    desc: 'Tennis mặt sân cứng ngoài trời',
  },
  BASKETBALL: {
    rules: [
      ['Giờ thường', '05:00', '17:00', 180_000],
      ['Cao điểm', '17:00', '24:00', 250_000],
    ],
    deposit: ['FIXED', 100_000],
    type: 'Nửa sân',
    desc: 'Bóng rổ trong nhà',
  },
};

export function buildSeed(version: number): DbState {
  setPublishMuted(true);
  try {
    return seedInner(version);
  } finally {
    setPublishMuted(false);
  }
}

function seedInner(version: number): DbState {
  const now = nowIso();
  const T = today();
  const createdLongAgo = `${addDays(T, -180)}T08:00:00+07:00`;

  const state: DbState = {
    version,
    seededAt: now,
    branches: [],
    sports: [],
    courts: [],
    blocks: [],
    holidays: [],
    users: [],
    bookings: [],
    paymentRequests: [],
    payments: [],
    bankTxns: [],
    refunds: [],
    promotions: [],
    notifications: [],
    seq: { 'CH:00000000': 1, 'NV:00000000': 4, 'KH:00000000': 4 },
    ids: { user: 30, priceRule: 0, court: 0 },
    idem: {},
    lastRecheck: {},
  };
  setDb(state);

  /* ---------------- chi nhánh */
  const branches: Branch[] = [
    {
      branchId: 1,
      code: 'CS01',
      name: 'Cơ sở 1 - Cầu Giấy',
      address: '128 Nguyễn Phong Sắc, Cầu Giấy, Hà Nội',
      phone: '02438881111',
      description: 'Cụm sân trung tâm, có bãi gửi xe và căng tin.',
      bankBin: '970436',
      bankName: 'Vietcombank',
      bankAccountNo: '1029384756',
      bankAccountName: 'SPORTHUB CAU GIAY',
      status: 'ACTIVE',
      openingHours: week('05:00', '23:00', ['06:00', '22:00']),
    },
    {
      branchId: 2,
      code: 'CS02',
      name: 'Cơ sở 2 - Thanh Xuân',
      address: '235 Nguyễn Trãi, Thanh Xuân, Hà Nội',
      phone: '02438882222',
      description: 'Sân bóng đá mini và cầu lông.',
      bankBin: '970422',
      bankName: 'MB Bank',
      bankAccountNo: '0886123456',
      bankAccountName: 'SPORTHUB THANH XUAN',
      status: 'ACTIVE',
      openingHours: week('05:30', '22:30'),
    },
    {
      branchId: 3,
      code: 'CS03',
      name: 'Cơ sở 3 - Long Biên',
      address: '52 Nguyễn Văn Cừ, Long Biên, Hà Nội',
      phone: '02438883333',
      description: 'Khu sân ngoài trời ven sông.',
      bankBin: '970407',
      bankName: 'Techcombank',
      bankAccountNo: '19036688999',
      bankAccountName: 'SPORTHUB LONG BIEN',
      status: 'ACTIVE',
      openingHours: week('06:00', '22:00'),
    },
  ];
  state.branches = branches;

  /* ---------------- bộ môn */
  const sports: Sport[] = [
    { sportId: 1, code: 'FOOTBALL', name: 'Bóng đá mini', icon: 'sport-football', gridBlockMinutes: 30, slotMinutes: 90, sortOrder: 2 },
    { sportId: 2, code: 'BADMINTON', name: 'Cầu lông', icon: 'sport-badminton', gridBlockMinutes: 60, slotMinutes: 60, sortOrder: 3 },
    { sportId: 3, code: 'TENNIS', name: 'Tennis', icon: 'sport-tennis', gridBlockMinutes: 60, slotMinutes: 120, sortOrder: 4 },
    { sportId: 4, code: 'BASKETBALL', name: 'Bóng rổ', icon: 'sport-basketball', gridBlockMinutes: 60, slotMinutes: 60, sortOrder: 5 },
    { sportId: 5, code: 'PICKLEBALL', name: 'Pickleball', icon: 'sport-pickleball', gridBlockMinutes: 60, slotMinutes: 120, sortOrder: 1 },
  ];
  state.sports = sports;
  const sportByCode = (c: string) => sports.find((s) => s.code === c)!;

  /* ---------------- sân + bảng giá */
  const SHORT: Record<string, string> = { PICKLEBALL: 'PK', BADMINTON: 'CL', FOOTBALL: 'BD', TENNIS: 'TN', BASKETBALL: 'BR' };
  const courtSpecs: [branchId: number, sport: string, no: number, status?: 'INACTIVE'][] = [
    [1, 'PICKLEBALL', 1], [1, 'PICKLEBALL', 2], [1, 'PICKLEBALL', 3],
    [1, 'BADMINTON', 1], [1, 'BADMINTON', 2],
    [1, 'FOOTBALL', 3], [1, 'TENNIS', 1], [1, 'BASKETBALL', 1],
    [2, 'FOOTBALL', 1], [2, 'FOOTBALL', 2], [2, 'BADMINTON', 3], [2, 'BADMINTON', 4], [2, 'PICKLEBALL', 4],
    [3, 'PICKLEBALL', 5], [3, 'PICKLEBALL', 6], [3, 'TENNIS', 2, 'INACTIVE'], [3, 'BADMINTON', 5], [3, 'FOOTBALL', 4],
  ];
  courtSpecs.forEach(([branchId, sportCode, no, status], i) => {
    const sp = sportByCode(sportCode);
    const tpl = PRICE[sportCode];
    const rules: PriceRule[] = tpl.rules.map(([label, startTime, endTime, pricePerHour]) => ({
      priceRuleId: ++state.ids.priceRule + 10,
      label,
      dayOfWeekMask: 127,
      startTime,
      endTime,
      pricePerHour,
      effectiveFrom: createdLongAgo,
      effectiveTo: null,
    }));
    const nn = String(no).padStart(2, '0');
    const court: Court = {
      courtId: i + 1,
      code: `SAN_${SHORT[sportCode]}_${nn}`,
      branchId,
      sportId: sp.sportId,
      name: `Sân ${sp.name} ${nn}`,
      courtType: tpl.type,
      description: tpl.desc,
      depositType: tpl.deposit[0],
      depositValue: tpl.deposit[1],
      status: status ?? 'ACTIVE',
      priceRules: rules,
      createdAt: createdLongAgo,
    };
    state.courts.push(court);
  });
  state.ids.court = state.courts.length;
  const court = (code: string) => state.courts.find((c) => c.code === code)!;

  /* ---------------- người dùng */
  const u = (x: Partial<User> & Pick<User, 'userId' | 'code' | 'fullName' | 'phone' | 'role'>): User => ({
    email: null,
    password: '123456',
    branchId: null,
    memberTier: null,
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    tokenVersion: 0,
    lastLoginAt: null,
    createdAt: createdLongAgo,
    ...x,
  });
  state.users = [
    u({ userId: 1, code: 'CH000001', fullName: 'Đặng Quốc Bảo', phone: '0901000001', email: 'owner@sporthub.vn', role: 'OWNER' }),
    u({ userId: 21, code: 'NV000001', fullName: 'Lê Văn Hùng', phone: '0933445566', email: 'hunglv@sporthub.vn', role: 'STAFF', branchId: 1, lastLoginAt: `${T}T07:58:00+07:00` }),
    u({ userId: 22, code: 'NV000002', fullName: 'Phạm Thu Trang', phone: '0933445577', email: 'trangpt@sporthub.vn', role: 'STAFF', branchId: 1 }),
    u({ userId: 23, code: 'NV000003', fullName: 'Vũ Minh Đức', phone: '0933445588', email: 'ducvm@sporthub.vn', role: 'STAFF', branchId: 2 }),
    u({ userId: 24, code: 'NV000004', fullName: 'Hoàng Thị Mai', phone: '0933445599', email: null, role: 'STAFF', branchId: 3, status: 'LOCKED' }),
    u({ userId: 15, code: 'KH000001', fullName: 'Nguyễn Văn An', phone: '0987654321', email: 'khachhang@sporthub.vn', role: 'CUSTOMER', memberTier: 'Hội viên thân thiết' }),
    u({ userId: 16, code: 'KH000002', fullName: 'Bùi Anh Tuấn', phone: '0933444555', email: 'tuanba@gmail.com', role: 'CUSTOMER' }),
    u({ userId: 17, code: 'KH000003', fullName: 'Trần Thị Hoa', phone: '0912223344', email: 'hoatt@gmail.com', role: 'CUSTOMER', memberTier: 'Hội viên Vàng' }),
    u({ userId: 18, code: 'KH000004', fullName: 'Phạm Gia Bảo', phone: '0988777666', email: 'baopg@gmail.com', role: 'CUSTOMER' }),
  ];

  /* ---------------- khuyến mãi */
  const promo = (x: Partial<Promotion> & Pick<Promotion, 'promotionId' | 'code' | 'name' | 'discountType' | 'discountValue' | 'maxUses'>): Promotion => ({
    description: null,
    maxDiscountAmount: null,
    allBranches: true,
    branchIds: [],
    allSports: true,
    sportIds: [],
    timeFrom: null,
    timeTo: null,
    startDate: addDays(T, -14),
    endDate: addDays(T, 30),
    audienceType: 'ALL',
    customerIds: [],
    usedCount: 0,
    status: 'ACTIVE',
    notifyStatus: 'NONE',
    createdBy: 1,
    createdAt: `${addDays(T, -15)}T10:00:00+07:00`,
    ...x,
  });
  state.promotions = [
    promo({ promotionId: 1, code: 'SANGVUI20', name: 'Ưu đãi khung giờ vàng buổi sáng', description: 'Giảm 20% (tối đa 100k) cho các khung giờ 6h–11h', discountType: 'PERCENT', discountValue: 20, maxDiscountAmount: 100_000, timeFrom: '06:00', timeTo: '11:00', maxUses: 200, usedCount: 82, notifyStatus: 'SENT' }),
    promo({ promotionId: 2, code: 'TRIAN10', name: 'Tri ân khách hàng thân thiết', description: 'Giảm 10% tiền thuê sân dành riêng cho hội viên thân thiết', discountType: 'PERCENT', discountValue: 10, audienceType: 'SPECIFIC', customerIds: [15, 17], maxUses: 50, usedCount: 4, notifyStatus: 'SENT' }),
    promo({ promotionId: 3, code: 'SALEGIOVANG20', name: 'Giờ thấp điểm buổi trưa', discountType: 'PERCENT', discountValue: 15, timeFrom: '10:00', timeTo: '15:00', allSports: false, sportIds: [5, 2], maxUses: 150, usedCount: 37 }),
    promo({ promotionId: 4, code: 'QUAYCG15', name: 'Ưu đãi đặt tại quầy Cầu Giấy', discountType: 'PERCENT', discountValue: 15, allBranches: false, branchIds: [1], maxUses: 100, usedCount: 11 }),
    promo({ promotionId: 5, code: 'GIAM50K', name: 'Giảm 50.000đ cho đơn bóng đá', discountType: 'FIXED', discountValue: 50_000, allSports: false, sportIds: [1], maxUses: 80, usedCount: 20, status: 'PAUSED' }),
    promo({ promotionId: 6, code: 'HE2026', name: 'Chào hè sôi động', discountType: 'PERCENT', discountValue: 25, maxDiscountAmount: 150_000, startDate: addDays(T, -120), endDate: addDays(T, -30), maxUses: 300, usedCount: 245, status: 'DISCONTINUED' }),
  ];
  state.ids.promotion = 6;

  /* ---------------- đơn đặt sân */
  interface Spec {
    day: number;
    court: string;
    start: string;
    end: string;
    customer?: number;
    guest?: [string, string];
    option: 'FULL' | 'DEPOSIT';
    promo?: string;
    channel?: 'ONLINE' | 'COUNTER';
    pay?: 'none' | 'due' | 'full';
    /** Tự chuyển nhận sân / hoàn thành nếu giờ chơi đã tới */
    play?: boolean;
    createdMinutesAgo?: number;
  }
  const STAFF_CG = 21;
  const make = (sp: Spec): Booking => {
    const c = court(sp.court);
    const date = addDays(T, sp.day);
    const startIso = at(date, sp.start);
    const channel = sp.channel ?? (sp.guest ? 'COUNTER' : 'ONLINE');
    const createdAt =
      sp.createdMinutesAgo != null
        ? addMinutes(now, -sp.createdMinutesAgo)
        : ms(startIso) < nowMs()
          ? addMinutes(startIso, -2 * 24 * 60)
          : addMinutes(now, -26 * 60);
    const staff = channel === 'COUNTER' ? (c.branchId === 1 ? STAFF_CG : 23) : null;
    const b = createBooking({
      court: c,
      date,
      startTime: sp.start,
      endTime: sp.end,
      paymentOption: sp.option,
      promotionCode: sp.promo ?? null,
      customerUserId: sp.customer ?? null,
      guestName: sp.guest?.[0] ?? null,
      guestPhone: sp.guest?.[1] ?? null,
      channel,
      createdBy: staff ?? sp.customer ?? null,
      at: createdAt,
      allowPast: true,
    });
    const payAt = addMinutes(createdAt, 2);
    if (sp.pay === 'due' || sp.pay === 'full') {
      recordPayment(b, {
        method: channel === 'COUNTER' ? 'CASH' : 'BANK_TRANSFER',
        channel,
        amount: b.amountDueNow,
        collectedBy: staff,
        at: payAt,
        note: channel === 'COUNTER' ? undefined : 'Webhook SEPAY – khớp giao dịch',
      });
    }
    if (sp.pay === 'full' && remainingOf(b) > 0) {
      recordPayment(b, { method: 'BANK_TRANSFER', channel, amount: remainingOf(b), at: addMinutes(payAt, 1) });
    }
    if (sp.play && b.status === 'CONFIRMED' && ms(b.startAt) <= nowMs()) {
      const staffOfBranch = c.branchId === 1 ? STAFF_CG : 23;
      if (remainingOf(b) > 0) {
        recordPayment(b, { purpose: 'REMAINING', method: 'CASH', channel: 'COUNTER', amount: remainingOf(b), collectedBy: staffOfBranch, at: b.startAt });
      }
      checkIn(b, staffOfBranch, b.startAt);
      if (ms(b.endAt) <= nowMs()) complete(b, null, null, b.endAt, true);
    }
    return b;
  };

  // Quá khứ
  make({ day: -3, court: 'SAN_PK_01', start: '18:00', end: '20:00', customer: 15, option: 'FULL', pay: 'due', play: true });
  make({ day: -2, court: 'SAN_CL_01', start: '17:00', end: '18:00', customer: 16, option: 'DEPOSIT', pay: 'due', play: true });
  make({ day: -2, court: 'SAN_BD_03', start: '18:30', end: '20:00', guest: ['Lý Quang Huy', '0977111222'], option: 'FULL', pay: 'due', play: true });
  const canceledYesterday = make({ day: -1, court: 'SAN_PK_03', start: '08:00', end: '10:00', customer: 17, option: 'DEPOSIT', promo: 'SANGVUI20', pay: 'due' });
  const expiredOne = make({ day: -1, court: 'SAN_TN_01', start: '15:00', end: '17:00', customer: 15, option: 'FULL', pay: 'none' });
  make({ day: -1, court: 'SAN_BD_01', start: '18:00', end: '19:30', customer: 16, option: 'FULL', pay: 'due', play: true });
  // Hôm nay
  make({ day: 0, court: 'SAN_TN_01', start: '06:00', end: '08:00', customer: 16, option: 'FULL', pay: 'due', play: true });
  make({ day: 0, court: 'SAN_CL_01', start: '08:00', end: '10:00', guest: ['Trần Minh Hoàng', '0905112233'], option: 'FULL', pay: 'due', play: true });
  make({ day: 0, court: 'SAN_PK_01', start: '18:00', end: '20:00', customer: 15, option: 'DEPOSIT', promo: 'TRIAN10', pay: 'due', play: true });
  make({ day: 0, court: 'SAN_CL_01', start: '19:00', end: '21:00', guest: ['Trần Minh Hoàng', '0905112233'], option: 'FULL', promo: 'QUAYCG15', pay: 'due', play: true });
  make({ day: 0, court: 'SAN_PK_02', start: '18:00', end: '20:00', customer: 16, option: 'DEPOSIT', pay: 'due', play: true });
  make({ day: 0, court: 'SAN_BD_03', start: '20:00', end: '21:30', customer: 17, option: 'FULL', pay: 'due', play: true });
  make({ day: 0, court: 'SAN_CL_04', start: '17:30', end: '19:30', guest: ['Đỗ Thanh Tùng', '0966555444'], option: 'DEPOSIT', pay: 'due', play: true });
  // Sắp tới
  make({ day: 1, court: 'SAN_PK_01', start: '07:00', end: '09:00', customer: 15, option: 'FULL', promo: 'SANGVUI20', pay: 'due' });
  make({ day: 1, court: 'SAN_CL_02', start: '17:00', end: '19:00', customer: 17, option: 'DEPOSIT', pay: 'due' });
  make({ day: 1, court: 'SAN_PK_02', start: '19:00', end: '21:00', customer: 15, option: 'FULL', pay: 'due' });
  make({ day: 2, court: 'SAN_BD_02', start: '18:00', end: '19:30', guest: ['Ngô Văn Long', '0911222333'], option: 'DEPOSIT', pay: 'due' });
  make({ day: 3, court: 'SAN_CL_03', start: '08:30', end: '10:30', customer: 17, option: 'FULL', pay: 'due' });
  const facilityClosed = make({ day: 4, court: 'SAN_PK_03', start: '16:00', end: '18:00', customer: 16, option: 'FULL', pay: 'due' });
  make({ day: 6, court: 'SAN_PK_05', start: '18:00', end: '20:00', customer: 15, option: 'FULL', pay: 'due' });
  const customerCanceled = make({ day: 8, court: 'SAN_BD_03', start: '18:30', end: '20:00', customer: 17, option: 'FULL', pay: 'due' });
  make({ day: 10, court: 'SAN_CL_02', start: '09:00', end: '11:00', customer: 16, option: 'FULL', pay: 'due' });
  // Đơn đang chờ thanh toán (giữ chỗ còn ~7 phút)
  const pending = make({ day: 1, court: 'SAN_PK_03', start: '18:00', end: '20:00', customer: 15, option: 'DEPOSIT', pay: 'none', createdMinutesAgo: 3 });
  createPaymentRequest(pending, null, null, pending.createdAt);

  // Hủy
  cancelBooking(canceledYesterday, {
    cancelType: 'CUSTOMER_REQUEST',
    reason: 'Bận công việc đột xuất không thể tham gia',
    by: 17,
    at: addMinutes(canceledYesterday.startAt, -20 * 60),
    silent: true,
  });
  cancelBooking(facilityClosed, { cancelType: 'BY_FACILITY', reason: 'Cơ sở đóng/ngừng nhận lịch – sự cố hệ thống chiếu sáng', by: 1, at: addMinutes(now, -60), silent: true });
  cancelBooking(customerCanceled, { cancelType: 'CUSTOMER_REQUEST', reason: 'Đổi lịch thi đấu của đội', by: 17, at: addMinutes(now, -120), silent: true });

  /* ---------------- khóa sân & ngày nghỉ (thêm sau để tạo "đơn bị ảnh hưởng") */
  state.blocks.push({
    blockId: 7,
    courtId: court('SAN_PK_02').courtId,
    blockType: 'MAINTENANCE',
    startAt: `${T}T14:00:00+07:00`,
    endAt: `${addDays(T, 2)}T18:00:00+07:00`,
    reason: 'Bảo trì mặt sân & thay lưới',
    createdBy: 1,
    createdAt: addMinutes(now, -24 * 60),
    releasedAt: null,
    releasedBy: null,
  });
  state.ids.block = 7;
  const d10 = addDays(T, 10);
  state.holidays.push({ holidayId: 1, branchId: 1, startDate: d10, endDate: d10, reason: 'Tạm nghỉ bảo dưỡng hệ thống điện', groupKey: `H-${d10.replace(/-/g, '')}-1`, createdBy: 1, createdAt: addMinutes(now, -48 * 60) });
  const newYear = `${Number(T.slice(0, 4)) + 1}-01-01`;
  [1, 2, 3].forEach((branchId, i) =>
    state.holidays.push({ holidayId: 2 + i, branchId, startDate: newYear, endDate: newYear, reason: 'Nghỉ Tết Dương lịch', groupKey: `H-${newYear.replace(/-/g, '')}-ALL`, createdBy: 1, createdAt: addMinutes(now, -72 * 60) }),
  );
  state.ids.holiday = 4;

  /* ---------------- giao dịch cần đối soát */
  applyBankTransfer({
    provider: 'SEPAY', providerTxnId: '92704', bankName: 'Vietcombank', accountNo: '1029384756',
    amount: 60_000, content: `THANHTOAN ${pending.bookingCode}`, transactionAt: addMinutes(now, -1), rawPayload: { id: 92704 },
  });
  applyBankTransfer({
    provider: 'SEPAY', providerTxnId: '92705', bankName: 'MB Bank', accountNo: '0886123456',
    amount: 150_000, content: 'CK tien san thu 7', transactionAt: addMinutes(now, -95), rawPayload: { id: 92705 },
  });
  applyBankTransfer({
    provider: 'SEPAY', providerTxnId: '92706', bankName: 'Vietcombank', accountNo: '1029384756',
    amount: expiredOne.amountDueNow, content: `THANHTOAN ${expiredOne.bookingCode}`, transactionAt: addMinutes(now, -300), rawPayload: { id: 92706 },
  });

  /* ---------------- chuẩn hóa: hết hạn giữ chỗ, nhắc lịch... */
  runJobs();

  // Thông báo cũ hơn 1 ngày coi như đã đọc
  state.notifications.forEach((n) => {
    if (ms(n.createdAt) < nowMs() - 86_400_000) {
      n.isRead = true;
      n.readAt = addMinutes(n.createdAt, 30);
    }
  });
  state.notifications.push({
    notificationId: 9000,
    userId: 15,
    type: 'PROMOTION',
    title: '🎁 Ưu đãi khung giờ vàng buổi sáng',
    body: 'Giảm 20% (tối đa 100k) cho các khung giờ 6h–11h. Nhập mã SANGVUI20 khi đặt sân.',
    linkType: 'PROMOTION',
    bookingCode: null,
    promotionCode: 'SANGVUI20',
    isRead: false,
    readAt: null,
    createdAt: addMinutes(now, -180),
  });
  state.notifications.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

  return state;
}
