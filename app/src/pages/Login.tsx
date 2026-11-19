import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Role } from '../data'
import { useApp } from '../appContext'

// Khối "Tài khoản đăng nhập nhanh" chỉ auto-fill cho môi trường demo (D8); hệ thống vẫn xác thực & tự nhận diện vai trò.
const QUICK: { role: Role; label: string; id: string; pw: string }[] = [
  { role: 'customer', label: 'Khách hàng', id: '0912345678', pw: 'Matkhau123' },
  { role: 'staff', label: 'Nhân viên thu ngân', id: '0933445566', pw: 'Nv123456' },
  { role: 'owner', label: 'Chủ hệ thống sân', id: '0900000001', pw: 'Chu123456' },
]

export default function Login() {
  const { login, register, toast, resetDemo } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const [tab, setTab] = useState<'login' | 'register'>((loc.state as { tab?: string } | null)?.tab === 'register' ? 'register' : 'login')
  const [role, setRole] = useState<Role>('customer')
  const [id, setId] = useState(QUICK[0].id)
  const [pw, setPw] = useState(QUICK[0].pw)
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [reg, setReg] = useState({ name: '', phone: '', email: '', password: '', confirm: '' })

  const pick = (r: Role) => {
    const q = QUICK.find((x) => x.role === r)!
    setRole(r); setId(q.id); setPw(q.pw); setErr('')
  }
  const submitLogin = (e: FormEvent) => {
    e.preventDefault()
    const res = login(id, pw)
    setErr(res.ok ? '' : res.error ?? 'Đăng nhập thất bại.')
  }
  const submitReg = (e: FormEvent) => {
    e.preventDefault()
    if (!/^[\p{L}\s]{2,100}$/u.test(reg.name.trim())) return setErr('Họ và tên phải từ 2–100 ký tự, chỉ gồm chữ cái và khoảng trắng (không chứa số, ký tự đặc biệt).')
    if (!/^0\d{9}$/.test(reg.phone)) return setErr('Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.')
    if (!/^\S{6,32}$/.test(reg.password)) return setErr('Mật khẩu phải gồm 6–32 ký tự và không chứa khoảng trắng.')
    if (reg.password !== reg.confirm) return setErr('Mật khẩu nhập lại không khớp.')
    if (!reg.email.trim()) return setErr('Email là bắt buộc khi đăng ký hội viên.')
    if (!/^\S+@\S+\.\S+$/.test(reg.email.trim())) return setErr('Địa chỉ email không hợp lệ.')
    const res = register(reg)
    if (!res.ok) return setErr(res.error ?? 'Đăng ký thất bại.')
    setErr('')
    toast('Đăng ký tài khoản thành công', 'ok')
    nav('/booking', { replace: true })
  }

  return (
    <div className="col" style={{ minHeight: '100vh' }}>
      <header className="hdr">
        <div className="container hdr-in">
          <div className="row g12">
            <div className="logo-mark">S</div>
            <div className="col g4" style={{ paddingBottom: 2.5 }}>
              <span className="logo-name">SportHub</span>
              <span className="logo-sub">Hệ thống đặt lịch sân thể thao</span>
            </div>
          </div>
          <button className="btn" style={{ background: 'var(--brand-50)', border: '1px solid var(--gray-200)', color: 'var(--brand-700)', padding: '8px 14px' }}
            onClick={() => nav('/')}>← Quay lại Trang chủ</button>
        </div>
      </header>

      <main className="container" style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '48px 16px' }}>
        <div className="grid12" style={{ width: '100%', gap: 32, alignItems: 'center', maxWidth: 1152, margin: '0 auto' }}>
          <div className="col g24" style={{ gridColumn: 'span 5' }}>
            <div className="hero col g20" style={{ padding: 28, background: 'var(--brand-800)' }}>
              <span className="badge" style={{ alignSelf: 'flex-start', background: 'rgba(4,120,87,.8)', border: '1px solid rgba(16,185,129,.4)', color: 'var(--brand-100)' }}>⚽ Đặt sân nhanh chóng • Giữ lịch tức thì</span>
              <h1 className="t24 w800" style={{ lineHeight: '33px', paddingTop: 1 }}>Đặt lịch sân thể thao mọi lúc, mọi nơi cùng SportHub</h1>
              <p className="t14" style={{ color: 'var(--brand-100)', lineHeight: '22.75px' }}>
                Tra cứu khung giờ trống theo thời gian thực tại 3 chi nhánh Hà Nội, thanh toán đặt cọc qua mã QR tiện lợi và nhận tin nhắn nhắc lịch tự động trước giờ bóng lăn 1 tiếng.
              </p>
              <div className="col g12" style={{ borderTop: '1px solid var(--brand-700)', paddingTop: 17 }}>
                {['Hiển thị bảng lịch trực quan, báo giá rõ ràng theo từng khung giờ', 'Hỗ trợ thanh toán trọn gói 100% hoặc đặt cọc giữ chỗ theo từng sân', 'Nhiều ưu đãi giảm giá khung giờ vàng cho hội viên thân thiết'].map((t) => (
                  <div className="row g12" key={t}>
                    <span className="center t12 w700" style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--brand-600)', flex: 'none' }}>✓</span>
                    <span className="t12">{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card row between g12" style={{ borderRadius: 16 }}>
              <div className="col g2">
                <span className="t12 w700 c-ink">Cần hỗ trợ mở khóa tài khoản hoặc đặt sân cố định?</span>
                <span className="t12 c-s600">Liên hệ trực tiếp quản lý hệ thống sân (05:00 – 23:00 hàng ngày)</span>
              </div>
              <span className="chip-box w800 c-brand" style={{ fontWeight: 800 }}>1900 6886</span>
            </div>
          </div>

          <div className="card card-raise" style={{ gridColumn: 'span 7', padding: '0 0 32px', overflow: 'hidden' }}>
            <div className="auth-tabs">
              <button className={`auth-tab${tab === 'login' ? ' on' : ''}`} onClick={() => { setTab('login'); setErr('') }}>Đăng nhập tài khoản</button>
              <button className={`auth-tab${tab === 'register' ? ' on' : ''}`} onClick={() => { setTab('register'); setErr('') }}>Đăng ký hội viên mới</button>
            </div>

            {tab === 'login' ? (
              <form noValidate className="col g20" style={{ padding: '32px 32px 0' }} onSubmit={submitLogin}>
                <div className="col g2">
                  <h2 className="t18 w800 c-ink">Chào mừng bạn quay trở lại!</h2>
                  <p className="t12 c-s600">Nhập số điện thoại hoặc email của bạn để bắt đầu đặt sân hoặc vào ca làm việc.</p>
                </div>
                <div className="col g16">
                  <div>
                    <label className="label" htmlFor="login-identity">Số điện thoại hoặc Email <span className="req">*</span></label>
                    <input id="login-identity" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" />
                  </div>
                  <div>
                    <div className="row between" style={{ marginBottom: 6 }}>
                      <label className="label" style={{ margin: 0 }} htmlFor="login-password">Mật khẩu <span className="req">*</span></label>
                      <button type="button" className="link-btn" onClick={() => setShow((s) => !s)}>Hiện / Ẩn</button>
                    </div>
                    <input id="login-password" className="input" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
                  </div>
                  <div className="hint col g8">
                    <span className="t12 w700 c-s800">Tài khoản đăng nhập nhanh:</span>
                    <div className="row g8">
                      {QUICK.map((q) => (
                        <label key={q.role} className="radio-card f1" style={{ padding: 10 }}>
                          <input type="radio" name="quick-role" checked={role === q.role} onChange={() => pick(q.role)} />
                          <span>{q.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {err && <p className="field-err">{err}</p>}
                  <button className="btn btn-primary btn-lg btn-block" type="submit">Đăng nhập ngay</button>
                </div>
                <div className="row between top-rule" style={{ paddingTop: 16 }}>
                  <span className="t12 c-s700">Bạn chưa có tài khoản đặt sân?</span>
                  <button type="button" className="link-btn" onClick={() => { setTab('register'); setErr('') }}>Tạo tài khoản mới miễn phí →</button>
                </div>
                <button type="button" className="link-btn" style={{ alignSelf: 'flex-start', fontSize: 11 }} onClick={resetDemo}>Khôi phục dữ liệu mẫu (demo)</button>
              </form>
            ) : (
              <form noValidate className="col g16" style={{ padding: '32px 32px 0' }} onSubmit={submitReg}>
                <div className="col g2">
                  <h2 className="t18 w800 c-ink">Trở thành hội viên SportHub</h2>
                  <p className="t12 c-s600">Đăng ký miễn phí để đặt sân nhanh, nhận ưu đãi giờ vàng và theo dõi lịch đặt của bạn.</p>
                </div>
                {([['name', 'Họ và tên', 'Nguyễn Văn An', 'text', true], ['phone', 'Số điện thoại', '0912345678', 'tel', true], ['email', 'Địa chỉ email', 'ban@example.com', 'email', true], ['password', 'Mật khẩu', 'Tối thiểu 6 ký tự', 'password', true], ['confirm', 'Nhập lại mật khẩu', 'Nhập lại mật khẩu', 'password', true]] as const).map(([k, l, ph, type, req]) => (
                  <div key={k}>
                    <label className="label">{l} {req && <span className="req">*</span>}</label>
                    <input className="input" type={type} placeholder={ph} value={reg[k]} onChange={(e) => setReg({ ...reg, [k]: e.target.value })} />
                  </div>
                ))}
                {err && <p className="field-err">{err}</p>}
                <button className="btn btn-primary btn-lg btn-block" type="submit">Đăng ký & Bắt đầu đặt sân</button>
                <div className="row between top-rule">
                  <span className="t12 c-s700">Đã có tài khoản?</span>
                  <button type="button" className="link-btn" onClick={() => { setTab('login'); setErr('') }}>Quay lại đăng nhập →</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
