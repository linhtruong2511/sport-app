/** API-01, 02, 06, 09, 10 — module auth */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db, nextCode, nextId } from '../db/store';
import type { User } from '../db/types';
import { ApiError, E } from '../lib/errors';
import { userView } from '../lib/mappers';
import { created, issueAccessToken, noContent, ok, route, session } from '../lib/http';
import { addMinutes, ms, nowIso, nowMs } from '../lib/time';

const A = MOCK_CONFIG.apiBase;

const tokenPayload = (u: User) => ({
  accessToken: issueAccessToken(u),
  tokenType: 'Bearer',
  expiresIn: MOCK_CONFIG.accessTokenTtlSec,
  user: userView(u),
});

export const PHONE_RE = /^0\d{9}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NAME_RE = /^[\p{L}\s]{2,100}$/u;

export const authHandlers = [
  // API-06
  http.post(`${A}/auth/login`, route(async (ctx) => {
    const { identity, password } = await ctx.body<{ identity?: string; password?: string }>();
    const id = (identity ?? '').trim().toLowerCase();
    if (!id) throw E.field('identity', 'Vui lòng nhập số điện thoại hoặc email.');
    if (!password || password.length < 6) throw E.field('password', 'Mật khẩu phải có tối thiểu 6 ký tự.');

    const st = MOCK_CONFIG.settings;
    const u = db().users.find((x) => x.phone === id || x.email?.toLowerCase() === id);
    if (!u) throw new ApiError(401, 'ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản với thông tin này.');
    if (u.lockedUntil && ms(u.lockedUntil) > nowMs()) {
      throw new ApiError(423, 'ACCOUNT_TEMP_LOCKED', `Bạn đã nhập sai mật khẩu quá ${st.LOGIN_MAX_FAILED} lần liên tiếp. Tài khoản bị tạm khóa trong ${st.LOGIN_LOCK_MINUTES} phút.`, { lockedUntil: u.lockedUntil });
    }
    if (u.status === 'LOCKED') {
      throw new ApiError(403, 'ACCOUNT_LOCKED', 'Tài khoản nhân viên đã bị khóa, vui lòng liên hệ chủ hệ thống.');
    }
    if (u.password !== password) {
      u.failedLoginCount += 1;
      if (u.failedLoginCount >= st.LOGIN_MAX_FAILED) {
        u.failedLoginCount = 0;
        u.lockedUntil = addMinutes(nowIso(), st.LOGIN_LOCK_MINUTES);
        throw new ApiError(423, 'ACCOUNT_TEMP_LOCKED', `Bạn đã nhập sai mật khẩu quá ${st.LOGIN_MAX_FAILED} lần liên tiếp. Tài khoản bị tạm khóa trong ${st.LOGIN_LOCK_MINUTES} phút.`, { lockedUntil: u.lockedUntil });
      }
      throw new ApiError(401, 'WRONG_PASSWORD', 'Mật khẩu không chính xác.', { remainingAttempts: st.LOGIN_MAX_FAILED - u.failedLoginCount });
    }
    u.failedLoginCount = 0;
    u.lockedUntil = null;
    u.lastLoginAt = nowIso();
    session.set(u);
    return ok(tokenPayload(u));
  })),

  // API-02
  http.post(`${A}/auth/refresh`, route(() => {
    const sess = session.get();
    const u = sess ? db().users.find((x) => x.userId === sess.userId) : undefined;
    if (!sess || !u || sess.exp < nowMs() || sess.tv !== u.tokenVersion || u.status === 'LOCKED') {
      session.clear();
      throw new ApiError(401, 'REFRESH_INVALID', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
    }
    session.set(u);
    const { tokenType: _t, ...rest } = tokenPayload(u);
    return ok(rest);
  })),

  // API-01
  http.get(`${A}/auth/me`, route((ctx) => ok(userView(ctx.auth('AUTH'))))),

  // API-09
  http.post(`${A}/auth/logout`, route(() => {
    session.clear();
    return noContent();
  })),

  // API-10
  http.post(`${A}/auth/register`, route(async (ctx) => {
    const b = await ctx.body<{ fullName?: string; phone?: string; email?: string; password?: string; confirmPassword?: string }>();
    const details: { field: string; message: string }[] = [];
    const fullName = (b.fullName ?? '').trim().replace(/\s+/g, ' ');
    const phone = (b.phone ?? '').trim();
    const email = (b.email ?? '').trim().toLowerCase();
    if (!NAME_RE.test(fullName)) details.push({ field: 'fullName', message: 'Họ và tên phải từ 2–100 ký tự, chỉ gồm chữ cái và khoảng trắng.' });
    if (!PHONE_RE.test(phone)) details.push({ field: 'phone', message: 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.' });
    if (!email) details.push({ field: 'email', message: 'Email là bắt buộc khi đăng ký hội viên.' });
    else if (!EMAIL_RE.test(email)) details.push({ field: 'email', message: 'Email không đúng định dạng.' });
    if (!b.password || b.password.length < 6 || b.password.length > 32 || /\s/.test(b.password)) {
      details.push({ field: 'password', message: 'Mật khẩu phải từ 6–32 ký tự và không chứa khoảng trắng.' });
    }
    if (b.password !== b.confirmPassword) details.push({ field: 'confirmPassword', message: 'Mật khẩu nhập lại không khớp.' });
    if (details.length) throw E.validation('Dữ liệu không hợp lệ.', details);

    const s = db();
    if (s.users.some((u) => u.phone === phone)) {
      throw E.conflict('PHONE_TAKEN', 'Số điện thoại này đã được sử dụng. Vui lòng đăng nhập hoặc dùng số khác.');
    }
    if (s.users.some((u) => u.email?.toLowerCase() === email)) {
      throw E.conflict('EMAIL_TAKEN', 'Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.');
    }
    const u: User = {
      userId: nextId('user'),
      code: nextCode('KH', null),
      fullName,
      phone,
      email,
      password: b.password!,
      role: 'CUSTOMER',
      branchId: null,
      memberTier: null,
      status: 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: 0,
      lastLoginAt: nowIso(),
      createdAt: nowIso(),
    };
    s.users.push(u);
    session.set(u);
    return created(tokenPayload(u));
  })),
];
