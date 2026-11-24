/** API-42 → 65 — quản trị: nhân viên, sân & bảng giá, khóa sân, giờ mở cửa, ngày nghỉ, khuyến mãi */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db, nextCode, nextId } from '../db/store';
import type { AmountType, Court, OpeningHour, PriceRule, Promotion, User } from '../db/types';
import { E } from '../lib/errors';
import { created, noContent, ok, paginate, route } from '../lib/http';
import { courtAdminView, promoAdminView, receiptView, staffView, withAffected } from '../lib/mappers';
import { activeRules } from '../lib/pricing';
import { affectedReasons, blockEnd, currentBlocks, findUser, LIVE_STATUSES, mustBranch, mustCourt, mustSport } from '../lib/schedule';
import { addDays, dateOf, isDate, isTime, ms, nowIso, today, toMin } from '../lib/time';
import { publish } from '../realtime';
import { emitSlot } from '../lib/ops';
import { EMAIL_RE, NAME_RE, PHONE_RE } from './auth';

const A = MOCK_CONFIG.apiBase;
const ROLE_LABEL: Record<User['role'], string> = { CUSTOMER: 'khách hàng', STAFF: 'nhân viên', OWNER: 'chủ hệ thống' };
const SHORT: Record<string, string> = { PICKLEBALL: 'PK', BADMINTON: 'CL', FOOTBALL: 'BD', TENNIS: 'TN', BASKETBALL: 'BR' };

const affectedIn = (branchId: number | null, courtId?: number) =>
  db().bookings.filter((b) => (branchId == null || b.branchId === branchId) && (courtId == null || b.courtId === courtId) && affectedReasons(b).length > 0);

/* ------------------------------------------------------------- validators */

interface StaffBody {
  fullName?: string;
  phone?: string;
  email?: string | null;
  branchId?: number;
  password?: string;
  status?: 'ACTIVE' | 'LOCKED';
}

function validateStaff(body: StaffBody, existing: User | null) {
  const details: { field: string; message: string }[] = [];
  const fullName = (body.fullName ?? '').trim().replace(/\s+/g, ' ');
  const phone = (body.phone ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase() || null;
  if (!NAME_RE.test(fullName)) details.push({ field: 'fullName', message: 'Họ và tên phải từ 2–100 ký tự, chỉ gồm chữ cái và khoảng trắng.' });
  if (!PHONE_RE.test(phone)) details.push({ field: 'phone', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.' });
  if (email && !EMAIL_RE.test(email)) details.push({ field: 'email', message: 'Email không đúng định dạng.' });
  if (!body.branchId || !db().branches.some((b) => b.branchId === body.branchId)) details.push({ field: 'branchId', message: 'Vui lòng chọn chi nhánh phân công.' });
  const needPw = !existing || !!body.password;
  if (needPw && (!body.password || body.password.length < 6 || body.password.length > 32 || /\s/.test(body.password))) {
    details.push({ field: 'password', message: 'Mật khẩu phải từ 6–32 ký tự và không chứa khoảng trắng.' });
  }
  if (details.length) throw E.validation('Dữ liệu không hợp lệ.', details);
  const s = db();
  const phoneOwner = s.users.find((u) => u.phone === phone && u.userId !== existing?.userId);
  if (phoneOwner) {
    throw E.conflict('PHONE_TAKEN', `Số điện thoại này đã được sử dụng bởi tài khoản ${ROLE_LABEL[phoneOwner.role]} khác.`, { takenByRole: phoneOwner.role });
  }
  const emailOwner = email ? s.users.find((u) => u.email?.toLowerCase() === email && u.userId !== existing?.userId) : undefined;
  if (emailOwner) {
    throw E.conflict('EMAIL_TAKEN', `Email này đã được sử dụng bởi tài khoản ${ROLE_LABEL[emailOwner.role]} khác.`, { takenByRole: emailOwner.role });
  }
  return { fullName, phone, email };
}

interface CourtBody {
  name?: string;
  branchId?: number;
  sportId?: number;
  courtType?: string | null;
  description?: string | null;
  depositType?: AmountType;
  depositValue?: number;
  status?: 'ACTIVE' | 'INACTIVE';
  priceRules?: { label?: string; dayOfWeekMask?: number; startTime?: string; endTime?: string; pricePerHour?: number }[];
}

function validateCourt(body: CourtBody, existing: Court | null) {
  const name = (body.name ?? '').trim();
  if (!name || name.length > 100) throw E.field('name', 'Tên sân bắt buộc, tối đa 100 ký tự.');
  if (!body.branchId) throw E.field('branchId', 'Vui lòng chọn chi nhánh.');
  mustBranch(body.branchId);
  if (!existing) {
    if (!body.sportId) throw E.field('sportId', 'Vui lòng chọn bộ môn.');
    mustSport(body.sportId);
  } else if (body.sportId != null && body.sportId !== existing.sportId) {
    throw E.validation('Không được đổi bộ môn của sân.', [{ field: 'sportId', message: 'Không được đổi bộ môn của sân.' }]);
  }
  if ((body.description ?? '').length > 500) throw E.field('description', 'Mô tả tối đa 500 ký tự.');
  if (db().courts.some((c) => c.branchId === body.branchId && c.name.toLowerCase() === name.toLowerCase() && c.courtId !== existing?.courtId)) {
    throw E.conflict('COURT_NAME_DUPLICATE', 'Tên sân đã tồn tại trong chi nhánh này.');
  }
  if (body.depositType === 'PERCENT') {
    if (!(Number(body.depositValue) >= 10 && Number(body.depositValue) <= 100)) throw E.rule('INVALID_DEPOSIT', 'Tỷ lệ đặt cọc phải nằm trong khoảng 10% – 100%.');
  } else if (body.depositType === 'FIXED') {
    if (!(Number(body.depositValue) > 0)) throw E.rule('INVALID_DEPOSIT', 'Tiền đặt cọc cố định phải lớn hơn 0.');
  } else throw E.field('depositType', 'Vui lòng chọn cách tính tiền cọc.');

  const rules = body.priceRules ?? [];
  if (!rules.length) throw E.field('priceRules', 'Cần ít nhất một khung giá.');
  rules.forEach((r, i) => {
    const label = r.label?.trim() || `#${i + 1}`;
    if (!isTime(r.startTime) || !isTime(r.endTime) || toMin(r.startTime) >= toMin(r.endTime)) {
      throw E.rule('INVALID_PRICE_RULE', `Khung giá ${label}: giờ kết thúc phải sau giờ bắt đầu.`);
    }
    if (!(Number(r.pricePerHour) > 0)) throw E.rule('INVALID_PRICE_RULE', 'Đơn giá thuê của mỗi khung phải lớn hơn 0.');
  });
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (((a.dayOfWeekMask ?? 127) & (b.dayOfWeekMask ?? 127)) === 0) continue;
      if (toMin(a.startTime!) < toMin(b.endTime!) && toMin(b.startTime!) < toMin(a.endTime!)) {
        throw E.rule('PRICE_RULE_OVERLAP', 'Các khung giá không được chồng chéo thời gian.');
      }
    }
  }
  return { name, rules };
}

function toRules(rules: NonNullable<CourtBody['priceRules']>, at: string): PriceRule[] {
  return rules.map((r) => ({
    priceRuleId: nextId('priceRule') + 10,
    label: r.label?.trim() || 'Khung giá',
    dayOfWeekMask: r.dayOfWeekMask ?? 127,
    startTime: r.startTime!,
    endTime: r.endTime!,
    pricePerHour: Number(r.pricePerHour),
    effectiveFrom: at,
    effectiveTo: null,
  }));
}

interface PromoBody {
  name?: string;
  code?: string;
  description?: string | null;
  discountType?: AmountType;
  discountValue?: number;
  maxDiscountAmount?: number | null;
  allBranches?: boolean;
  branchIds?: number[];
  allSports?: boolean;
  sportIds?: number[];
  timeFrom?: string | null;
  timeTo?: string | null;
  startDate?: string;
  endDate?: string;
  maxUses?: number;
  audienceType?: 'ALL' | 'SPECIFIC';
  customerPhones?: string[];
  notifyCustomers?: boolean;
}

function validatePromo(b: PromoBody, existing: Promotion | null) {
  const details: { field: string; message: string }[] = [];
  const name = (b.name ?? '').trim();
  const code = (b.code ?? '').trim().toUpperCase();
  if (name.length < 5 || name.length > 150) details.push({ field: 'name', message: 'Tên chương trình ưu đãi phải từ 5 đến 150 ký tự.' });
  if (!/^[A-Z0-9]{4,20}$/.test(code)) details.push({ field: 'code', message: 'Mã giảm giá gồm 4–20 ký tự chữ hoa hoặc số, không dấu.' });
  if (b.discountType === 'PERCENT' && !(Number(b.discountValue) >= 1 && Number(b.discountValue) <= 100)) {
    details.push({ field: 'discountValue', message: 'Mức giảm theo % phải từ 1 đến 100.' });
  }
  if (b.discountType === 'FIXED' && !(Number(b.discountValue) > 0)) details.push({ field: 'discountValue', message: 'Số tiền giảm phải lớn hơn 0.' });
  if (b.discountType !== 'PERCENT' && b.discountType !== 'FIXED') details.push({ field: 'discountType', message: 'Vui lòng chọn loại giảm giá.' });
  if (b.allBranches === false && !b.branchIds?.length) details.push({ field: 'branchIds', message: 'Vui lòng chọn cơ sở áp dụng.' });
  if (b.allSports === false && !b.sportIds?.length) details.push({ field: 'sportIds', message: 'Vui lòng chọn bộ môn áp dụng.' });
  if ((b.timeFrom || b.timeTo) && (!isTime(b.timeFrom) || !isTime(b.timeTo) || toMin(b.timeFrom) >= toMin(b.timeTo))) {
    details.push({ field: 'timeFrom', message: 'Khung giờ tùy chỉnh không hợp lệ (giờ bắt đầu phải trước giờ kết thúc).' });
  }
  if (!isDate(b.startDate) || !isDate(b.endDate) || b.startDate > b.endDate) details.push({ field: 'startDate', message: 'Khoảng ngày áp dụng không hợp lệ.' });
  if (!(Number(b.maxUses) > 0)) details.push({ field: 'maxUses', message: 'Số lượt sử dụng tối đa phải lớn hơn 0.' });
  if (b.audienceType === 'SPECIFIC' && !b.customerPhones?.length) details.push({ field: 'customerPhones', message: 'Vui lòng nhập số điện thoại khách được chỉ định.' });
  if (details.length) throw E.validation('Dữ liệu không hợp lệ.', details);

  const s = db();
  if (s.promotions.some((p) => p.code === code && p.promotionId !== existing?.promotionId)) {
    throw E.conflict('PROMO_CODE_DUPLICATE', 'Mã giảm giá này đã tồn tại.');
  }
  let customerIds: number[] = [];
  if (b.audienceType === 'SPECIFIC') {
    const bad: string[] = [];
    for (const phone of b.customerPhones ?? []) {
      const u = s.users.find((x) => x.role === 'CUSTOMER' && x.phone === phone.trim());
      if (u) customerIds.push(u.userId);
      else bad.push(phone);
    }
    if (bad.length) throw E.rule('CUSTOMER_NOT_FOUND', `Số điện thoại không thuộc tài khoản khách hàng: ${bad.join(', ')}`, { phones: bad });
    customerIds = [...new Set(customerIds)];
  }
  return { name, code, customerIds };
}

/* ------------------------------------------------------------- handlers */

export const adminHandlers = [
  /* ---------- MH.10 nhân viên */
  // API-42
  http.get(`${A}/admin/staff`, route((ctx) => {
    ctx.auth('OWNER');
    const branchId = ctx.qNum('branchId');
    const status = ctx.q('status');
    const q = (ctx.q('q') ?? '').toLowerCase();
    const all = db().users.filter((u) => u.role === 'STAFF');
    const list = all
      .filter((u) => branchId == null || u.branchId === branchId)
      .filter((u) => !status || u.status === status)
      .filter((u) => !q || [u.fullName, u.phone, u.email ?? '', u.code].some((v) => v.toLowerCase().includes(q)));
    const { items, meta } = paginate(list, ctx.query);
    const countByBranch: Record<string, number> = {};
    all.forEach((u) => (countByBranch[String(u.branchId)] = (countByBranch[String(u.branchId)] ?? 0) + 1));
    return ok(items.map(staffView), {
      meta: { ...meta, activeCount: all.filter((u) => u.status === 'ACTIVE').length, lockedCount: all.filter((u) => u.status === 'LOCKED').length, countByBranch },
    });
  })),

  // API-43
  http.post(`${A}/admin/staff`, route(async (ctx) => {
    ctx.auth('OWNER');
    const body = await ctx.body<StaffBody>();
    const v = validateStaff(body, null);
    const u: User = {
      userId: nextId('user'),
      code: nextCode('NV', null),
      ...v,
      password: body.password!,
      role: 'STAFF',
      branchId: body.branchId!,
      memberTier: null,
      status: body.status === 'LOCKED' ? 'LOCKED' : 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: 0,
      lastLoginAt: null,
      createdAt: nowIso(),
    };
    db().users.push(u);
    return created(staffView(u));
  })),

  // API-44
  http.put(`${A}/admin/staff/:userId`, route(async (ctx) => {
    ctx.auth('OWNER');
    const u = db().users.find((x) => x.userId === Number(ctx.p('userId')) && x.role === 'STAFF');
    if (!u) throw E.notFound('Không tìm thấy nhân viên.');
    const body = await ctx.body<StaffBody>();
    const v = validateStaff(body, u);
    const revoke = body.branchId !== u.branchId || (body.status === 'LOCKED' && u.status !== 'LOCKED');
    const reason = body.branchId !== u.branchId ? 'BRANCH_CHANGED' : 'ACCOUNT_LOCKED';
    Object.assign(u, v, { branchId: body.branchId });
    if (body.password) u.password = body.password;
    if (body.status) u.status = body.status;
    if (revoke) {
      u.tokenVersion += 1;
      publish('auth.revoked', [`user:${u.userId}`], { reason });
    }
    return ok(staffView(u));
  })),

  // API-45
  http.post(`${A}/admin/staff/:userId/:action`, route((ctx) => {
    ctx.auth('OWNER');
    const action = ctx.p('action');
    if (action !== 'lock' && action !== 'unlock') throw E.notFound();
    const u = db().users.find((x) => x.userId === Number(ctx.p('userId')) && x.role === 'STAFF');
    if (!u) throw E.notFound('Không tìm thấy nhân viên.');
    if (action === 'lock') {
      u.status = 'LOCKED';
      u.tokenVersion += 1;
      publish('auth.revoked', [`user:${u.userId}`], { reason: 'ACCOUNT_LOCKED' });
    } else {
      u.status = 'ACTIVE';
      u.failedLoginCount = 0;
      u.lockedUntil = null;
    }
    return ok(staffView(u));
  })),

  // API-46
  http.get(`${A}/admin/staff/:userId/payments`, route((ctx) => {
    ctx.auth('OWNER');
    const id = Number(ctx.p('userId'));
    const from = ctx.q('from') ?? '0000-01-01';
    const to = ctx.q('to') ?? '9999-12-31';
    const list = db()
      .payments.filter((p) => p.collectedBy === id && dateOf(p.paidAt) >= from && dateOf(p.paidAt) <= to)
      .sort((a, b) => ms(b.paidAt) - ms(a.paidAt));
    const { items, meta } = paginate(list, ctx.query);
    return ok(items.map(receiptView), { meta: { ...meta, totalAmount: list.reduce((s, p) => s + p.amount, 0) } });
  })),

  /* ---------- MH.11.1 sân & bảng giá */
  // API-47
  http.get(`${A}/admin/courts`, route((ctx) => {
    ctx.auth('OWNER');
    const branchId = ctx.qNum('branchId');
    const sportId = ctx.qNum('sportId');
    const status = ctx.q('status');
    const list = db().courts.filter(
      (c) => (branchId == null || c.branchId === branchId) && (sportId == null || c.sportId === sportId) && (!status || c.status === status),
    );
    return ok(list.map(courtAdminView));
  })),

  // API-48
  http.get(`${A}/admin/courts/:courtId`, route((ctx) => {
    ctx.auth('OWNER');
    const c = mustCourt(Number(ctx.p('courtId')));
    const hasOpenBookings = db().bookings.some((b) => b.courtId === c.courtId && LIVE_STATUSES.includes(b.status));
    return ok({ ...courtAdminView(c), hasOpenBookings });
  })),

  // API-49
  http.post(`${A}/admin/courts`, route(async (ctx) => {
    ctx.auth('OWNER');
    const body = await ctx.body<CourtBody>();
    const { name, rules } = validateCourt(body, null);
    const sport = mustSport(body.sportId!);
    const s = db();
    const prefix = `SAN_${SHORT[sport.code] ?? sport.code.slice(0, 2)}_`;
    const maxNo = s.courts.filter((c) => c.code.startsWith(prefix)).reduce((m, c) => Math.max(m, Number(c.code.slice(prefix.length)) || 0), 0);
    const now = nowIso();
    const c: Court = {
      courtId: nextId('court'),
      code: `${prefix}${String(maxNo + 1).padStart(2, '0')}`,
      branchId: body.branchId!,
      sportId: sport.sportId,
      name,
      courtType: body.courtType ?? null,
      description: body.description ?? null,
      depositType: body.depositType!,
      depositValue: Number(body.depositValue),
      status: body.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      priceRules: toRules(rules, now),
      createdAt: now,
    };
    s.courts.push(c);
    return created(courtAdminView(c));
  })),

  // API-50
  http.put(`${A}/admin/courts/:courtId`, route(async (ctx) => {
    ctx.auth('OWNER');
    const c = mustCourt(Number(ctx.p('courtId')));
    const body = await ctx.body<CourtBody>();
    const { name, rules } = validateCourt(body, c);
    const s = db();
    if (body.branchId !== c.branchId && s.bookings.some((b) => b.courtId === c.courtId && LIVE_STATUSES.includes(b.status))) {
      throw E.conflict('COURT_HAS_OPEN_BOOKINGS', 'Sân đang có đơn đặt chưa hoàn thành, không thể đổi chi nhánh. Vui lòng xử lý các đơn hiện có trước.');
    }
    const now = nowIso();
    const sig = (r: { label?: string; dayOfWeekMask?: number; startTime?: string; endTime?: string; pricePerHour?: number }) =>
      `${r.label?.trim()}|${r.dayOfWeekMask ?? 127}|${r.startTime}|${r.endTime}|${Number(r.pricePerHour)}`;
    const changed = activeRules(c).map(sig).sort().join(';') !== rules.map(sig).sort().join(';');
    if (changed) {
      activeRules(c).forEach((r) => (r.effectiveTo = now));
      c.priceRules.push(...toRules(rules, now));
    }
    Object.assign(c, {
      name,
      branchId: body.branchId!,
      courtType: body.courtType ?? c.courtType,
      description: body.description ?? c.description,
      depositType: body.depositType!,
      depositValue: Number(body.depositValue),
      status: body.status ?? c.status,
    });
    return ok({ court: courtAdminView(c), affectedCount: c.status === 'INACTIVE' ? affectedIn(null, c.courtId).length : 0 });
  })),

  /* ---------- MH.11.2 khóa sân */
  // API-51
  http.get(`${A}/admin/court-blocks`, route((ctx) => {
    ctx.auth('OWNER');
    const branchId = ctx.qNum('branchId');
    const active = ctx.q('active') !== 'false';
    const s = db();
    const list = (active ? currentBlocks() : s.blocks)
      .filter((b) => branchId == null || s.courts.find((c) => c.courtId === b.courtId)?.branchId === branchId)
      .sort((a, b) => ms(a.startAt) - ms(b.startAt));
    return ok(
      list.map((b) => {
        const c = mustCourt(b.courtId);
        return {
          blockId: b.blockId,
          court: { courtId: c.courtId, code: c.code, name: c.name, branchName: mustBranch(c.branchId).name },
          blockType: b.blockType,
          startAt: b.startAt,
          endAt: b.endAt,
          effectiveEndAt: blockEnd(b),
          reason: b.reason,
          createdByName: findUser(b.createdBy)?.fullName ?? null,
          createdAt: b.createdAt,
          releasedAt: b.releasedAt,
        };
      }),
    );
  })),

  // API-52
  http.post(`${A}/admin/court-blocks`, route(async (ctx) => {
    const user = ctx.auth('OWNER');
    const dryRun = ctx.q('dryRun') === 'true';
    const body = await ctx.body<{ courtId?: number; blockType?: 'MAINTENANCE' | 'DECOMMISSION'; startAt?: string; endAt?: string | null; reason?: string }>();
    if (!body.courtId) throw E.field('courtId', 'Vui lòng chọn sân cần khóa.');
    const c = mustCourt(body.courtId);
    if (body.blockType !== 'MAINTENANCE' && body.blockType !== 'DECOMMISSION') throw E.field('blockType', 'Vui lòng chọn hình thức khóa.');
    if (!body.startAt || Number.isNaN(ms(body.startAt))) throw E.field('startAt', 'Thời gian bắt đầu không hợp lệ.');
    if (body.blockType === 'MAINTENANCE' && (!body.endAt || ms(body.endAt) <= ms(body.startAt))) throw E.field('endAt', 'Thời gian kết thúc phải sau thời gian bắt đầu.');
    if (!body.reason?.trim()) throw E.field('reason', 'Vui lòng nhập lý do khóa sân.');
    if (body.reason.length > 255) throw E.field('reason', 'Lý do tối đa 255 ký tự.');
    const endAt = body.blockType === 'DECOMMISSION' ? null : body.endAt!;
    const s = db();
    if (currentBlocks(c.courtId).some((b) => ms(b.startAt) < (endAt ? ms(endAt) : Infinity) && (blockEnd(b) == null || ms(blockEnd(b)!) > ms(body.startAt!)))) {
      throw E.conflict('BLOCK_OVERLAP', 'Sân đã có lịch khóa chồng thời gian.');
    }
    const blk = {
      blockId: nextId('block'),
      courtId: c.courtId,
      blockType: body.blockType,
      startAt: body.startAt,
      endAt,
      reason: body.reason.trim(),
      createdBy: user.userId,
      createdAt: nowIso(),
      releasedAt: null,
      releasedBy: null,
    };
    s.blocks.push(blk);
    const affected = affectedIn(null, c.courtId);
    if (dryRun) s.blocks.pop();
    else affected.forEach((b) => emitSlot(b));
    return created({
      block: dryRun ? null : { blockId: blk.blockId, courtId: blk.courtId, blockType: blk.blockType },
      affectedCount: affected.length,
      affectedBookings: affected.map((b) => withAffected(b, user)),
    });
  })),

  // API-53
  http.post(`${A}/admin/court-blocks/:blockId/release`, route((ctx) => {
    const user = ctx.auth('OWNER');
    const blk = db().blocks.find((b) => b.blockId === Number(ctx.p('blockId')));
    if (!blk) throw E.notFound('Không tìm thấy lịch khóa sân.');
    if (!blk.releasedAt) {
      blk.releasedAt = nowIso();
      blk.releasedBy = user.userId;
    }
    const c = mustCourt(blk.courtId);
    publish('slot.updated', [`branch:${c.branchId}`, `availability:${c.branchId}:${today()}`], {
      branchId: c.branchId, courtId: c.courtId, date: today(), startTime: null, endTime: null, state: 'FREE',
    });
    return ok({ blockId: blk.blockId, releasedAt: blk.releasedAt, releasedByName: findUser(blk.releasedBy)?.fullName ?? null });
  })),

  /* ---------- MH.11.3 giờ mở cửa & ngày nghỉ */
  // API-54
  http.get(`${A}/admin/branches/:branchId/opening-hours`, route((ctx) => {
    ctx.auth('OWNER');
    const b = mustBranch(Number(ctx.p('branchId')));
    return ok({ branchId: b.branchId, days: b.openingHours });
  })),

  // API-55
  http.put(`${A}/admin/branches/:branchId/opening-hours`, route(async (ctx) => {
    const user = ctx.auth('OWNER');
    const b = mustBranch(Number(ctx.p('branchId')));
    const dryRun = ctx.q('dryRun') === 'true';
    const { days } = await ctx.body<{ days?: OpeningHour[] }>();
    const DAY = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
    if (!Array.isArray(days) || days.length !== 7 || new Set(days.map((d) => d.dayOfWeek)).size !== 7) {
      throw E.field('days', 'Cần đủ 7 ngày trong tuần (dayOfWeek 1–7).');
    }
    for (const d of days) {
      if (!d.isClosed && (!isTime(d.openTime) || !isTime(d.closeTime) || toMin(d.openTime) >= toMin(d.closeTime))) {
        throw E.rule('INVALID_OPENING_HOURS', `${b.name} – ${DAY[d.dayOfWeek]}: Giờ đóng cửa phải lớn hơn giờ mở cửa.`);
      }
    }
    const old = b.openingHours;
    b.openingHours = [...days]
      .sort((x, y) => x.dayOfWeek - y.dayOfWeek)
      .map((d) => ({ dayOfWeek: d.dayOfWeek, openTime: d.isClosed ? null : d.openTime, closeTime: d.isClosed ? null : d.closeTime, isClosed: !!d.isClosed }));
    const affected = affectedIn(b.branchId);
    const result = { branchId: b.branchId, days: b.openingHours, affectedCount: affected.length, affectedBookings: affected.map((x) => withAffected(x, user)) };
    if (dryRun) b.openingHours = old;
    return ok(result);
  })),

  // API-56
  http.get(`${A}/admin/holidays`, route((ctx) => {
    ctx.auth('OWNER');
    const branchId = ctx.qNum('branchId');
    const from = isDate(ctx.q('from')) ? ctx.q('from')! : today();
    const list = db()
      .holidays.filter((h) => (branchId == null || h.branchId === branchId) && h.endDate >= from)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.branchId - b.branchId);
    return ok(
      list.map((h) => ({
        holidayId: h.holidayId,
        branch: { branchId: h.branchId, name: mustBranch(h.branchId).name },
        startDate: h.startDate,
        endDate: h.endDate,
        reason: h.reason,
        groupKey: h.groupKey,
      })),
    );
  })),

  // API-57
  http.post(`${A}/admin/holidays`, route(async (ctx) => {
    const user = ctx.auth('OWNER');
    const dryRun = ctx.q('dryRun') === 'true';
    const body = await ctx.body<{ startDate?: string; days?: number; scope?: 'ALL' | 'BRANCH'; branchId?: number | null; reason?: string }>();
    if (!isDate(body.startDate)) throw E.field('startDate', 'Ngày bắt đầu không hợp lệ.');
    if (body.startDate < today()) throw E.rule('HOLIDAY_IN_PAST', 'Không thể thêm ngày nghỉ trong quá khứ.');
    const days = Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 60) throw E.field('days', 'Số ngày nghỉ liên tiếp phải từ 1 đến 60.');
    if (body.scope !== 'ALL' && body.scope !== 'BRANCH') throw E.field('scope', 'Vui lòng chọn phạm vi áp dụng.');
    if (body.scope === 'BRANCH' && !body.branchId) throw E.field('branchId', 'Vui lòng chọn chi nhánh.');
    const s = db();
    const branchIds = body.scope === 'ALL' ? s.branches.map((b) => b.branchId) : [mustBranch(body.branchId!).branchId];
    const endDate = addDays(body.startDate, days - 1);
    const groupKey = `H-${body.startDate.replace(/-/g, '')}-${body.scope === 'ALL' ? 'ALL' : body.branchId}`;
    const createdList = branchIds.map((branchId) => ({
      holidayId: nextId('holiday'),
      branchId,
      startDate: body.startDate!,
      endDate,
      reason: body.reason?.trim() || 'Nghỉ lễ',
      groupKey,
      createdBy: user.userId,
      createdAt: nowIso(),
    }));
    s.holidays.push(...createdList);
    const affected = branchIds.flatMap((id) => affectedIn(id));
    if (dryRun) s.holidays.splice(s.holidays.length - createdList.length, createdList.length);
    return created({
      holidays: dryRun ? [] : createdList.map((h) => ({ holidayId: h.holidayId, branchId: h.branchId })),
      affectedCount: affected.length,
      affectedBookings: affected.map((b) => withAffected(b, user)),
    });
  })),

  // API-58
  http.delete(`${A}/admin/holidays/:holidayId`, route((ctx) => {
    ctx.auth('OWNER');
    const s = db();
    const h = s.holidays.find((x) => x.holidayId === Number(ctx.p('holidayId')));
    if (!h) throw E.notFound('Không tìm thấy ngày nghỉ.');
    s.holidays = ctx.q('group') === 'true' ? s.holidays.filter((x) => x.groupKey !== h.groupKey) : s.holidays.filter((x) => x.holidayId !== h.holidayId);
    return noContent();
  })),

  /* ---------- MH.12 khuyến mãi */
  // API-59
  http.get(`${A}/admin/promotions`, route((ctx) => {
    ctx.auth('OWNER');
    const status = ctx.q('status');
    const q = (ctx.q('q') ?? '').toLowerCase();
    const list = db()
      .promotions.filter((p) => !status || p.status === status)
      .filter((p) => !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    return ok(list.map(promoAdminView));
  })),

  // API-60
  http.get(`${A}/admin/promotions/:promotionId`, route((ctx) => {
    ctx.auth('OWNER');
    const p = db().promotions.find((x) => x.promotionId === Number(ctx.p('promotionId')));
    if (!p) throw E.notFound('Không tìm thấy chương trình khuyến mãi.');
    return ok({
      ...promoAdminView(p),
      customers: p.customerIds.map((id) => findUser(id)).filter(Boolean).map((u) => ({ userId: u!.userId, fullName: u!.fullName, phone: u!.phone })),
    });
  })),

  // API-61
  http.post(`${A}/admin/promotions`, route(async (ctx) => {
    const user = ctx.auth('OWNER');
    const b = await ctx.body<PromoBody>();
    const v = validatePromo(b, null);
    const p: Promotion = {
      promotionId: nextId('promotion'),
      code: v.code,
      name: v.name,
      description: b.description ?? null,
      discountType: b.discountType!,
      discountValue: Number(b.discountValue),
      maxDiscountAmount: b.discountType === 'PERCENT' && b.maxDiscountAmount ? Number(b.maxDiscountAmount) : null,
      allBranches: b.allBranches !== false,
      branchIds: b.allBranches === false ? b.branchIds ?? [] : [],
      allSports: b.allSports !== false,
      sportIds: b.allSports === false ? b.sportIds ?? [] : [],
      timeFrom: b.timeFrom || null,
      timeTo: b.timeTo || null,
      startDate: b.startDate!,
      endDate: b.endDate!,
      audienceType: b.audienceType === 'SPECIFIC' ? 'SPECIFIC' : 'ALL',
      customerIds: v.customerIds,
      maxUses: Number(b.maxUses),
      usedCount: 0,
      status: 'ACTIVE',
      notifyStatus: b.notifyCustomers ? 'PENDING' : 'NONE',
      createdBy: user.userId,
      createdAt: nowIso(),
    };
    db().promotions.push(p);
    return created(promoAdminView(p));
  })),

  // API-62
  http.put(`${A}/admin/promotions/:promotionId`, route(async (ctx) => {
    ctx.auth('OWNER');
    const p = db().promotions.find((x) => x.promotionId === Number(ctx.p('promotionId')));
    if (!p) throw E.notFound('Không tìm thấy chương trình khuyến mãi.');
    if (p.status === 'DISCONTINUED') throw E.rule('PROMO_DISCONTINUED', 'Chương trình đã ngừng áp dụng, không sửa được.');
    const b = await ctx.body<PromoBody>();
    const v = validatePromo(b, p);
    if (v.code !== p.code && p.usedCount > 0) throw E.rule('PROMO_CODE_LOCKED', 'Không thể đổi mã khi chương trình đã có lượt sử dụng.');
    if (Number(b.maxUses) < p.usedCount) throw E.rule('MAX_USES_TOO_LOW', `Số lượt tối đa không được nhỏ hơn số lượt đã dùng (${p.usedCount}).`);
    Object.assign(p, {
      code: v.code,
      name: v.name,
      description: b.description ?? null,
      discountType: b.discountType,
      discountValue: Number(b.discountValue),
      maxDiscountAmount: b.discountType === 'PERCENT' && b.maxDiscountAmount ? Number(b.maxDiscountAmount) : null,
      allBranches: b.allBranches !== false,
      branchIds: b.allBranches === false ? b.branchIds ?? [] : [],
      allSports: b.allSports !== false,
      sportIds: b.allSports === false ? b.sportIds ?? [] : [],
      timeFrom: b.timeFrom || null,
      timeTo: b.timeTo || null,
      startDate: b.startDate,
      endDate: b.endDate,
      audienceType: b.audienceType === 'SPECIFIC' ? 'SPECIFIC' : 'ALL',
      customerIds: v.customerIds,
      maxUses: Number(b.maxUses),
      notifyStatus: b.notifyCustomers ? 'PENDING' : p.notifyStatus,
    });
    return ok(promoAdminView(p));
  })),

  // API-63
  http.post(`${A}/admin/promotions/:promotionId/:action`, route((ctx) => {
    ctx.auth('OWNER');
    const action = ctx.p('action');
    const p = db().promotions.find((x) => x.promotionId === Number(ctx.p('promotionId')));
    if (!p) throw E.notFound('Không tìm thấy chương trình khuyến mãi.');
    if (action === 'notify') {
      // API-65
      p.notifyStatus = 'PENDING';
      return ok({ promotionId: p.promotionId, notifyStatus: p.notifyStatus }, { status: 202 });
    }
    if (action !== 'pause' && action !== 'resume') throw E.notFound();
    if (p.status === 'DISCONTINUED') throw E.rule('PROMO_DISCONTINUED', 'Chương trình đã ngừng áp dụng.');
    p.status = action === 'pause' ? 'PAUSED' : 'ACTIVE';
    return ok({ promotionId: p.promotionId, status: p.status });
  })),

  // API-64
  http.delete(`${A}/admin/promotions/:promotionId`, route((ctx) => {
    ctx.auth('OWNER');
    const s = db();
    const p = s.promotions.find((x) => x.promotionId === Number(ctx.p('promotionId')));
    if (!p) throw E.notFound('Không tìm thấy chương trình khuyến mãi.');
    if (p.usedCount === 0) {
      s.promotions = s.promotions.filter((x) => x.promotionId !== p.promotionId);
      return noContent();
    }
    p.status = 'DISCONTINUED';
    return ok({
      promotionId: p.promotionId,
      deleted: false,
      status: p.status,
      message: `Mã ${p.code} đã có ${p.usedCount} lượt sử dụng nên chuyển sang Ngừng áp dụng.`,
    });
  })),
];
