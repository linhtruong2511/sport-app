import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.ts';
import { useAuth } from '../auth/authContext.ts';
import { useToast } from '../ui/toastContext.ts';
import { extractErrorMessage } from '../utils/format.ts';

interface RegisterFormState {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
}

type RegisterField = keyof RegisterFormState;

const INITIAL_REGISTER_STATE: RegisterFormState = {
  fullName: '',
  phone: '',
  email: '',
  password: '',
  confirmPassword: '',
};

const FULL_NAME_RE = /^[\p{L}\s]{2,100}$/u;
const PHONE_RE = /^0\d{9}$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PASSWORD_CHAR_RE = /^(?=.*[A-Za-z])(?=.*\d)\S{8,32}$/;

function extractFieldErrors(err: unknown): Partial<Record<RegisterField, string>> {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) {
    return {};
  }
  const map: Partial<Record<RegisterField, string>> = {};
  for (const item of err.details) {
    if (!item || typeof item !== 'object') continue;
    const field = item.field;
    const message = item.message;
    if (
      typeof field === 'string' &&
      typeof message === 'string' &&
      (field === 'fullName' ||
        field === 'phone' ||
        field === 'email' ||
        field === 'password' ||
        field === 'confirmPassword')
    ) {
      map[field] = message;
    }
  }
  return map;
}

export default function Login() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const loc = useLocation();

  const initialTab =
    (loc.state as { tab?: string } | null)?.tab === 'register' ? 'register' : 'login';

  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [fieldErrs, setFieldErrs] = useState<Partial<Record<RegisterField, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reg, setReg] = useState<RegisterFormState>(INITIAL_REGISTER_STATE);

  const switchTab = (nextTab: 'login' | 'register') => {
    setTab(nextTab);
    setErr('');
    setFieldErrs({});
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedIdentity = identity.trim();
    if (!trimmedIdentity) {
      setErr('Vui lòng nhập số điện thoại hoặc email.');
      return;
    }
    if (password.length < 6 || password.length > 32) {
      setErr('Mật khẩu phải từ 6 đến 32 ký tự.');
      return;
    }

    setErr('');
    setSubmitting(true);
    try {
      await login({ identity: trimmedIdentity, password });
    } catch (error) {
      setErr(extractErrorMessage(error, 'Đăng nhập thất bại.'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateRegField = (field: RegisterField, value: string) => {
    setReg((prev) => ({ ...prev, [field]: value }));
    if (fieldErrs[field]) {
      setFieldErrs((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const fullName = reg.fullName.trim();
    const phone = reg.phone.trim();
    const email = reg.email.trim();
    const nextFieldErrs: Partial<Record<RegisterField, string>> = {};

    if (!FULL_NAME_RE.test(fullName)) {
      nextFieldErrs.fullName =
        'Họ tên phải từ 2 đến 100 ký tự, chỉ gồm chữ cái và khoảng trắng.';
    }
    if (!PHONE_RE.test(phone)) {
      nextFieldErrs.phone = 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.';
    }
    if (!email) {
      nextFieldErrs.email = 'Email là bắt buộc khi đăng ký hội viên.';
    } else if (/\s/.test(email) || !EMAIL_RE.test(email) || email.length > 255) {
      nextFieldErrs.email = 'Email không đúng định dạng.';
    }
    if (!PASSWORD_CHAR_RE.test(reg.password)) {
      nextFieldErrs.password =
        'Mật khẩu phải từ 8 đến 32 ký tự, gồm ít nhất 1 chữ cái, 1 chữ số và không chứa khoảng trắng.';
    }
    if (reg.password !== reg.confirmPassword) {
      nextFieldErrs.confirmPassword = 'Mật khẩu nhập lại không khớp.';
    }

    const firstError =
      nextFieldErrs.fullName ??
      nextFieldErrs.phone ??
      nextFieldErrs.email ??
      nextFieldErrs.password ??
      nextFieldErrs.confirmPassword;

    if (firstError) {
      setFieldErrs(nextFieldErrs);
      setErr(firstError);
      return;
    }

    setErr('');
    setFieldErrs({});
    setSubmitting(true);
    try {
      await register({
        fullName,
        phone,
        email,
        password: reg.password,
        confirmPassword: reg.confirmPassword,
      });
      toast('Đăng ký tài khoản thành công. Chào mừng bạn đến với Thể thao 88!', 'ok');
      nav('/booking', { replace: true });
    } catch (error) {
      const apiFieldErrs = extractFieldErrors(error);
      setFieldErrs(apiFieldErrs);
      setErr(extractErrorMessage(error, 'Đăng ký thất bại.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="col" style={{ minHeight: '100vh' }}>
      <header className="hdr">
        <div className="container hdr-in">
          <div className="row g12" style={{ minWidth: 0 }}>
            <div className="logo-mark">
              <img src="/logo-88-sports-transparent-256x256.png" alt="Logo Thể thao 88" />
            </div>
            <div className="col g4" style={{ paddingBottom: 2.5, minWidth: 0 }}>
              <span className="logo-name">Thể thao 88</span>
              <span className="logo-sub nowrap">Hệ thống đặt lịch sân thể thao</span>
            </div>
          </div>
          <button
            type="button"
            className="btn"
            style={{
              background: 'var(--brand-50)',
              border: '1px solid var(--gray-200)',
              color: 'var(--brand-700)',
              padding: '8px 14px',
              flex: 'none',
            }}
            onClick={() => nav('/')}
          >
            ← Quay lại Trang chủ
          </button>
        </div>
      </header>

      <main className="container login-main">
        <div className="grid12 login-grid">
          <div className="span5 col g24">
            <div className="hero col g20 login-hero-box">
              <span
                className="badge"
                style={{
                  alignSelf: 'flex-start',
                  background: 'rgba(4,120,87,.8)',
                  border: '1px solid rgba(16,185,129,.4)',
                  color: 'var(--brand-100)',
                  whiteSpace: 'normal',
                }}
              >
                ⚽ Đặt sân nhanh chóng • Giữ lịch tức thì
              </span>
              <h1 className="t24 w800" style={{ lineHeight: '33px', paddingTop: 1 }}>
                Đặt lịch sân thể thao mọi lúc, mọi nơi cùng Thể thao 88
              </h1>
              <p className="t14" style={{ color: 'var(--brand-100)', lineHeight: '22.75px' }}>
                Tra cứu khung giờ trống theo thời gian thực tại hệ thống chi nhánh Thể thao 88, thanh
                toán đặt cọc qua mã QR tiện lợi và nhận thông báo nhắc lịch tự động trước giờ bóng
                lăn 1 tiếng.
              </p>
              <div
                className="col g12"
                style={{ borderTop: '1px solid var(--brand-700)', paddingTop: 17 }}
              >
                {[
                  'Hiển thị bảng lịch trực quan, báo giá rõ ràng theo từng khung giờ',
                  'Hỗ trợ thanh toán trọn gói 100% hoặc đặt cọc giữ chỗ theo từng sân',
                  'Nhiều ưu đãi giảm giá khung giờ vàng cho hội viên thân thiết',
                ].map((text) => (
                  <div className="row g12" key={text}>
                    <span
                      className="center t12 w700"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 8,
                        background: 'var(--brand-600)',
                        flex: 'none',
                      }}
                    >
                      ✓
                    </span>
                    <span className="t12">{text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card row between wrap g12" style={{ borderRadius: 16 }}>
              <div className="col g2 f1">
                <span className="t12 w700 c-ink">
                  Cần hỗ trợ mở khóa tài khoản hoặc đặt sân cố định?
                </span>
                <span className="t12 c-s600">
                  Liên hệ trực tiếp quản lý hệ thống sân (05:00 – 23:00 hàng ngày)
                </span>
              </div>
              <span className="chip-box w800 c-brand" style={{ fontWeight: 800 }}>
                1900 6886
              </span>
            </div>
          </div>

          <div className="span7 card card-raise login-form-card">
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab${tab === 'login' ? ' on' : ''}`}
                onClick={() => switchTab('login')}
              >
                Đăng nhập tài khoản
              </button>
              <button
                type="button"
                className={`auth-tab${tab === 'register' ? ' on' : ''}`}
                onClick={() => switchTab('register')}
              >
                Đăng ký hội viên mới
              </button>
            </div>

            {tab === 'login' ? (
              <form
                noValidate
                className="col g20 login-form"
                onSubmit={(e) => void submitLogin(e)}
              >
                <div className="col g2">
                  <h2 className="t18 w800 c-ink">Chào mừng bạn quay trở lại!</h2>
                  <p className="t12 c-s600">
                    Nhập số điện thoại hoặc email của bạn để bắt đầu đặt sân hoặc vào ca làm việc.
                  </p>
                </div>
                <div className="col g16">
                  <div>
                    <label className="label" htmlFor="login-identity">
                      Số điện thoại hoặc Email <span className="req">*</span>
                    </label>
                    <input
                      id="login-identity"
                      className="input"
                      placeholder="0912345678 hoặc email@example.com"
                      value={identity}
                      onChange={(e) => setIdentity(e.target.value)}
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <div className="row between" style={{ marginBottom: 6 }}>
                      <label className="label" style={{ margin: 0 }} htmlFor="login-password">
                        Mật khẩu <span className="req">*</span>
                      </label>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setShowPassword((prev) => !prev)}
                      >
                        {showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      </button>
                    </div>
                    <input
                      id="login-password"
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Nhập mật khẩu"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  {err && (
                    <p className="field-err" role="alert">
                      {err}
                    </p>
                  )}
                  <button
                    className="btn btn-primary btn-lg btn-block"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting ? 'Đang đăng nhập...' : 'Đăng nhập ngay'}
                  </button>
                </div>
                <div className="row between wrap g8 top-rule" style={{ paddingTop: 16 }}>
                  <span className="t12 c-s700">Bạn chưa có tài khoản đặt sân?</span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => switchTab('register')}
                  >
                    Tạo tài khoản mới miễn phí →
                  </button>
                </div>
              </form>
            ) : (
              <form
                noValidate
                className="col g16 login-form"
                onSubmit={(e) => void submitRegister(e)}
              >
                <div className="col g2">
                  <h2 className="t18 w800 c-ink">Trở thành hội viên Thể thao 88</h2>
                  <p className="t12 c-s600">
                    Đăng ký miễn phí để đặt sân nhanh, nhận ưu đãi giờ vàng và theo dõi lịch đặt
                    của bạn.
                  </p>
                </div>
                <div>
                  <label className="label" htmlFor="reg-fullname">
                    Họ và tên <span className="req">*</span>
                  </label>
                  <input
                    id="reg-fullname"
                    className="input"
                    type="text"
                    placeholder="Nguyễn Văn An"
                    value={reg.fullName}
                    onChange={(e) => updateRegField('fullName', e.target.value)}
                    autoComplete="name"
                  />
                  {fieldErrs.fullName && <p className="field-err">{fieldErrs.fullName}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="reg-phone">
                    Số điện thoại <span className="req">*</span>
                  </label>
                  <input
                    id="reg-phone"
                    className="input"
                    type="tel"
                    placeholder="0912345678"
                    value={reg.phone}
                    onChange={(e) => updateRegField('phone', e.target.value)}
                    autoComplete="tel"
                  />
                  {fieldErrs.phone && <p className="field-err">{fieldErrs.phone}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="reg-email">
                    Địa chỉ email <span className="req">*</span>
                  </label>
                  <input
                    id="reg-email"
                    className="input"
                    type="email"
                    placeholder="ban@example.com"
                    value={reg.email}
                    onChange={(e) => updateRegField('email', e.target.value)}
                    autoComplete="email"
                  />
                  {fieldErrs.email && <p className="field-err">{fieldErrs.email}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="reg-password">
                    Mật khẩu <span className="req">*</span>
                  </label>
                  <input
                    id="reg-password"
                    className="input"
                    type="password"
                    placeholder="Tối thiểu 8 ký tự, gồm chữ cái và số"
                    value={reg.password}
                    onChange={(e) => updateRegField('password', e.target.value)}
                    autoComplete="new-password"
                  />
                  {fieldErrs.password && <p className="field-err">{fieldErrs.password}</p>}
                </div>
                <div>
                  <label className="label" htmlFor="reg-confirm">
                    Nhập lại mật khẩu <span className="req">*</span>
                  </label>
                  <input
                    id="reg-confirm"
                    className="input"
                    type="password"
                    placeholder="Nhập lại mật khẩu"
                    value={reg.confirmPassword}
                    onChange={(e) => updateRegField('confirmPassword', e.target.value)}
                    autoComplete="new-password"
                  />
                  {fieldErrs.confirmPassword && (
                    <p className="field-err">{fieldErrs.confirmPassword}</p>
                  )}
                </div>
                {err && !Object.values(fieldErrs).includes(err) && (
                  <p className="field-err" role="alert">
                    {err}
                  </p>
                )}
                <button
                  className="btn btn-primary btn-lg btn-block"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? 'Đang tạo tài khoản...' : 'Đăng ký & Bắt đầu đặt sân'}
                </button>
                <div className="row between wrap g8 top-rule">
                  <span className="t12 c-s700">Đã có tài khoản?</span>
                  <button type="button" className="link-btn" onClick={() => switchTab('login')}>
                    Quay lại đăng nhập →
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
