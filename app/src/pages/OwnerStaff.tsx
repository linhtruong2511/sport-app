import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Staff } from '../data'
import type { StaffOutlet } from '../layouts'
import { useApp } from '../appContext'
import { fmt, vnd } from '../utils/format'

const TONE = { green: 'b-green', sky: 'b-sky', indigo: 'b-indigo' } as const
const empty = { name: '', phone: '', email: '', branchId: 'cs1', password: '', locked: false }

export default function OwnerStaff() {
  const { staff, setStaff, branches, transactions, bookings, identityTaken, toast } = useApp()
  const { branchFilter, setBranchFilter } = useOutletContext<StaffOutlet>()
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'locked'>('all')
  const [txOf, setTxOf] = useState<Staff | null>(null)

  const kw = search.trim().toLowerCase()
  const list = staff.filter((s) => (branchFilter === 'all' || s.branchId === branchFilter)
    && (status === 'all' || (status === 'locked') === s.locked)
    && (!kw || [s.id, s.name, s.phone, s.email].some((x) => x.toLowerCase().includes(kw))))
  const inBranch = staff.filter((s) => branchFilter === 'all' || s.branchId === branchFilter)
  const active = inBranch.filter((s) => !s.locked).length
  const locked = inBranch.length - active
  const bOf = (id: string) => branches.find((b) => b.id === id)!
  // Số đơn & tổng thu = số liệu lưu trữ cũ + cộng dồn từ giao dịch thực tế nhân viên đã thu trên prototype
  const liveOf = (id: string) => {
    const t = transactions.filter((x) => x.staffId === id)
    return { n: new Set(t.map((x) => x.bookingId)).size, sum: t.reduce((a, x) => a + x.amount, 0), list: t }
  }

  const edit = (s: Staff) => { setEditId(s.id); setForm({ name: s.name, phone: s.phone, email: s.email, branchId: s.branchId, password: '', locked: s.locked }); setErr('') }
  const reset = () => { setEditId(null); setForm({ ...empty, branchId: branchFilter === 'all' ? 'cs1' : branchFilter }); setErr('') }
  const toggleLock = (s: Staff) => {
    setStaff((ss) => ss.map((x) => (x.id === s.id ? { ...x, locked: !x.locked } : x)))
    toast(s.locked ? `Đã mở khóa tài khoản ${s.name}.` : `Đã khóa tài khoản ${s.name}. Tài khoản không thể đăng nhập nhưng lịch sử giao dịch vẫn được lưu giữ.`, 'ok')
  }

  const save = () => {
    if (!/^[\p{L}\s]{2,100}$/u.test(form.name.trim())) return setErr('Họ và tên phải từ 2–100 ký tự, chỉ gồm chữ cái và khoảng trắng.')
    const phone = form.phone.trim(), email = form.email.trim()
    if (!/^0\d{9}$/.test(phone)) return setErr('Số điện thoại đăng nhập phải gồm 10 chữ số và bắt đầu bằng 0.')
    if (staff.some((s) => s.phone === phone && s.id !== editId)) return setErr('Số điện thoại này đã được cấp cho nhân viên khác.')
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return setErr('Địa chỉ email không hợp lệ.')
    const taken = identityTaken(phone, email, editId)
    if (taken.phone) return setErr(`Số điện thoại này đã được sử dụng bởi tài khoản ${taken.phone === 'customer' ? 'khách hàng' : taken.phone === 'owner' ? 'chủ hệ thống' : 'nhân viên'} khác.`)
    if (taken.email) return setErr(`Email này đã được sử dụng bởi tài khoản ${taken.email === 'customer' ? 'khách hàng' : taken.email === 'owner' ? 'chủ hệ thống' : 'nhân viên'} khác.`)
    if (!editId && !/^\S{6,32}$/.test(form.password)) return setErr('Mật khẩu cấp mới phải gồm 6–32 ký tự và không chứa khoảng trắng.')
    if (editId && form.password && !/^\S{6,32}$/.test(form.password)) return setErr('Mật khẩu mới phải gồm 6–32 ký tự và không chứa khoảng trắng.')
    if (editId) {
      setStaff((ss) => ss.map((s) => (s.id === editId ? { ...s, name: form.name.trim(), phone, email, branchId: form.branchId, locked: form.locked, password: form.password || s.password } : s)))
      toast(`Đã cập nhật thông tin ${form.name}.`, 'ok')
    } else {
      const id = `NV${String(staff.length + 1).padStart(3, '0')}`
      setStaff((ss) => [...ss, { id, name: form.name.trim(), phone, email, branchId: form.branchId, locked: form.locked, password: form.password, orders: 0, revenue: 0 }])
      toast(`Đã cấp tài khoản ${id} cho ${form.name}.`, 'ok')
    }
    reset()
  }

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g12 wrap">
          <span className="t12 w700 c-s700">Lọc theo chi nhánh:</span>
          <select className="select sm bold fit" style={{ background: 'var(--s50)', padding: '8px 30px 8px 18px', borderRadius: 12 }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">Tất cả chi nhánh ({staff.length} nhân sự)</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name.replace(' - ', ' – ')} ({staff.filter((s) => s.branchId === b.id).length} nhân sự)</option>)}
          </select>
          <input data-testid="staff-search" className="input sm" style={{ width: 220, background: 'var(--s50)', borderRadius: 12 }} placeholder="Tìm theo tên, SĐT, email, mã NV" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select data-testid="staff-status-filter" className="select sm fit" style={{ background: 'var(--s50)', borderRadius: 12 }} value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'active' | 'locked')}>
            <option value="all">Mọi trạng thái</option><option value="active">Đang làm việc</option><option value="locked">Đã khóa</option>
          </select>
          <span className="badge b-green-flat" style={{ borderRadius: 8, padding: '6px 12px' }}>{active} Đang làm việc</span>
          <span className="badge b-rose-soft" style={{ borderRadius: 8, padding: '6px 12px', background: 'var(--rose-100)', color: 'var(--rose-900)' }}>{locked} Đã khóa tài khoản</span>
        </div>
        <button className="btn btn-primary btn-md" style={{ padding: '8px 16px' }} onClick={reset}>+ Thêm nhân viên mới</button>
      </section>

      <div className="grid12">
        <section className="span8 card col g16">
          <div className="row between">
            <h2 className="t14 w800 c-ink">Danh sách nhân viên thu ngân tại các cơ sở</h2>
            <span className="t12 c-s600">Nhấp "Sửa" để thay đổi cơ sở hoặc thông tin liên hệ</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Mã NV / Họ và tên</th><th>Số điện thoại / Email</th><th>Chi nhánh làm việc</th><th>Giao dịch đã thực hiện</th><th>Trạng thái</th><th className="r">Thao tác</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>Không tìm thấy nhân viên phù hợp.</td></tr>}
                {list.map((s) => {
                  const live = liveOf(s.id)
                  return (
                    <tr key={s.id} className={s.locked ? 'dim' : editId === s.id ? 'hl' : ''}>
                      <td><div className="mono w800" style={{ fontSize: 10.5, color: s.locked ? 'var(--s700)' : 'var(--s900)' }}>{s.id}</div><div className="w700" style={{ color: s.locked ? 'var(--s700)' : 'var(--s800)' }}>{s.name}</div></td>
                      <td><div className="mono w700" style={{ fontSize: 11 }}>{s.phone}</div><div className="c-s600">{s.email}</div></td>
                      <td><span className={`badge ${s.locked ? 'b-gray' : TONE[bOf(s.branchId).tone]}`} style={{ borderRadius: 8, fontWeight: s.locked ? 600 : 700, background: s.locked ? 'var(--s200)' : undefined }}>{bOf(s.branchId).name}</span></td>
                      <td><div className="w700">{s.locked && s.archived ? `${s.archived + live.n} đơn (Đã lưu trữ)` : `${s.orders + live.n} đơn tại quầy`}</div><div className={s.locked ? 'c-brand8 w700' : 'c-s600'}>Tổng thu: {fmt(s.revenue + live.sum)}đ</div></td>
                      <td><span className={`badge ${s.locked ? 'b-rose' : 'b-green'}`} style={{ background: s.locked ? 'var(--rose-100)' : undefined }}>{s.locked ? 'Đã khóa' : 'Đang làm việc'}</span></td>
                      <td className="r">
                        <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" style={{ padding: '6px 10px', color: 'var(--s800)' }} onClick={() => setTxOf(s)}>Giao dịch</button>
                          <button className="btn btn-outline btn-sm" style={{ padding: '6px 10px', color: 'var(--s800)' }} onClick={() => edit(s)}>Sửa</button>
                          {s.locked
                            ? <button className="btn btn-sm" style={{ background: '#fff', border: '1px solid var(--brand-400)', color: 'var(--brand-800)', padding: '6px 10px' }} onClick={() => toggleLock(s)}>Mở khóa</button>
                            : <button className="btn btn-danger-o btn-sm" style={{ padding: '6px 10px' }} onClick={() => toggleLock(s)}>Khóa</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ lineHeight: '16px' }}>
            🔒 Khi khóa tài khoản nhân viên đã nghỉ việc, tài khoản đó sẽ không thể đăng nhập vào hệ thống nhưng toàn bộ lịch sử hóa đơn và giao dịch thu tiền trước đây vẫn được lưu giữ đầy đủ để đối soát doanh thu. Có thể mở khóa lại bất cứ lúc nào.
          </div>
        </section>

        <aside className="span4 card card-lg card-raise col g16" style={{ padding: 20 }}>
          <div className="col head-rule" style={{ gap: 3.5, paddingTop: 5 }}>
            <span className="eyebrow">Thông tin tài khoản</span>
            <h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>{editId ? `Chỉnh sửa nhân viên ${editId}` : 'Thêm nhân viên mới'}</h3>
          </div>
          <form noValidate className="col g14" onSubmit={(e) => { e.preventDefault(); save() }}>
            <Field label="Họ và tên nhân viên" req><input className="input sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Số điện thoại đăng nhập" req><input className="input sm bold" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Địa chỉ Email"><input className="input sm" style={{ fontWeight: 500 }} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Chi nhánh phân công" req>
              <select className="select sm" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <Field label={editId ? 'Mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu cấp mới'} req={!editId}><input className="input sm" style={{ fontWeight: 500 }} type="text" placeholder="Tối thiểu 6 ký tự" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Trạng thái làm việc">
              <select className="select sm" value={form.locked ? 'locked' : 'active'} onChange={(e) => setForm({ ...form, locked: e.target.value === 'locked' })}><option value="active">Đang làm việc</option><option value="locked">Đã khóa tài khoản</option></select></Field>
            {err && <p className="field-err">{err}</p>}
            <div className="row g8" style={{ paddingTop: 4 }}>
              <button className="btn btn-primary btn-md f1" type="submit">Lưu thông tin</button>
              <button className="btn btn-outline btn-md" type="button" onClick={reset}>Nhập lại</button>
            </div>
          </form>
        </aside>
      </div>

      {txOf && (
        <div className="modal-bg" onClick={() => setTxOf(null)}>
          <div className="modal" style={{ maxWidth: 560, maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="t18 w800 c-ink">Giao dịch thu tiền của {txOf.name}</h3>
            <p className="t12 c-s600">Gồm {txOf.orders} đơn / {vnd(txOf.revenue)} đã lưu trữ và các giao dịch phát sinh trên hệ thống:</p>
            {liveOf(txOf.id).list.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 16 }}>Chưa có giao dịch mới nào phát sinh.</div>}
            {liveOf(txOf.id).list.map((t) => {
              const bk = bookings.find((b) => b.id === t.bookingId)
              return <div key={t.id} className="row between g12 t12" style={{ border: '1px solid var(--s300)', borderRadius: 10, padding: 10 }}>
                <div className="col"><b className="c-ink mono">{t.id} • #{t.bookingId}</b><span className="c-s600">{bk?.customer} • {t.at}</span></div>
                <div className="col" style={{ alignItems: 'flex-end' }}><b className="c-brand8">{vnd(t.amount)}</b><span className="c-s600">{t.kind === 'SETTLEMENT' ? 'Tất toán' : t.kind === 'DEPOSIT' ? 'Thu cọc' : 'Thu đủ'} • {t.method === 'qr' ? 'VietQR' : 'Tiền mặt'}</span></div>
              </div>
            })}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-outline btn-md" onClick={() => setTxOf(null)}>Đóng</button></div>
          </div>
        </div>
      )}
    </>
  )
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return <div><label className="label" style={{ marginBottom: 4 }}>{label} {req && <span className="req">*</span>}</label>{children}</div>
}
