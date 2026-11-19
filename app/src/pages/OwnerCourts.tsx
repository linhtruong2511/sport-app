import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { SPORTS, TODAY, makeRules, sportOf } from '../data'
import type { Court, DayHours, PriceRule, SportKey } from '../data'
import type { StaffOutlet } from '../layouts'
import { useApp } from '../appContext'
import AffectedBookingsModal from '../components/AffectedBookingsModal'
import { affectedByHoliday, affectedByHours, affectedByLock, openBookingsOfCourt } from '../domain/affected'
import { addDays, fmt, mins, toVN } from '../utils/format'

type Tab = 1 | 2 | 3
interface CourtForm { name: string; branchId: string; sport: SportKey; description: string; depositType: 'percent' | 'fixed'; deposit: number; priceRules: PriceRule[]; active: boolean }
const emptyForm: CourtForm = { name: '', branchId: 'cs1', sport: 'pickleball', description: '', depositType: 'percent', deposit: 30, priceRules: makeRules(150000, 250000), active: true }
const DAYS: [number, string][] = [[1, 'Thứ Hai'], [2, 'Thứ Ba'], [3, 'Thứ Tư'], [4, 'Thứ Năm'], [5, 'Thứ Sáu'], [6, 'Thứ Bảy'], [0, 'Chủ Nhật']]
const FOREVER = '9999-12-31T23:59'
const dt = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11)}`

export default function OwnerCourts() {
  const { courts, setCourts, branches, setBranches, locks, setLocks, holidays, setHolidays, bookings, flagAffected, toast } = useApp()
  const { branchFilter } = useOutletContext<StaffOutlet>()
  const [tab, setTab] = useState<Tab>(1)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<CourtForm>(emptyForm)
  const [err, setErr] = useState('')
  const [hol, setHol] = useState({ date: '', days: 1, branchId: 'all', note: '' })
  const [holErr, setHolErr] = useState('')
  const [lk, setLk] = useState({ mode: 'temp' as 'temp' | 'stop', courtId: '', from: `${TODAY}T08:00`, to: `${TODAY}T18:00`, reason: 'Bảo trì mặt sân' })
  const [lkErr, setLkErr] = useState('')
  const [draft, setDraft] = useState<Record<string, DayHours[]>>(() => Object.fromEntries(branches.map((b) => [b.id, b.hours.map((h) => ({ ...h }))])))
  const [hb, setHb] = useState(branchFilter === 'all' ? branches[0].id : branchFilter)
  const [hErr, setHErr] = useState('')

  const list = courts.filter((c) => branchFilter === 'all' || c.branchId === branchFilter)
  const bName = (id: string) => branches.find((b) => b.id === id)?.name ?? ''
  const lockOf = (id: string) => locks.find((l) => l.courtId === id && l.to.slice(0, 10) >= TODAY)
  const affected = bookings.filter((b) => b.isAffected && ['pending', 'confirmed', 'overdue'].includes(b.status)
    && (branchFilter === 'all' || courts.find((c) => c.id === b.courtId)?.branchId === branchFilter))

  const edit = (c: Court) => { setEditId(c.id); setForm({ name: c.name, branchId: c.branchId, sport: c.sport, description: c.description, depositType: c.depositType, deposit: c.deposit, priceRules: c.priceRules.map((r) => ({ ...r })), active: c.active }); setErr('') }
  const reset = () => { setEditId(null); setForm({ ...emptyForm, priceRules: makeRules(150000, 250000), branchId: branchFilter === 'all' ? 'cs1' : branchFilter }); setErr('') }
  const setRule = (i: number, p: Partial<PriceRule>) => setForm((f) => ({ ...f, priceRules: f.priceRules.map((r, j) => (j === i ? { ...r, ...p } : r)) }))

  const save = () => {
    const name = form.name.trim()
    if (!name) return setErr('Vui lòng nhập tên sân thi đấu.')
    if (name.length > 100) return setErr('Tên sân tối đa 100 ký tự.')
    const old = editId ? courts.find((c) => c.id === editId) : undefined
    if (old && old.branchId !== form.branchId && openBookingsOfCourt(bookings, old.id, TODAY).length) return setErr('Sân đang có đơn đặt chưa hoàn thành, không thể đổi chi nhánh. Vui lòng xử lý các đơn hiện có trước.')
    if (courts.some((c) => c.id !== editId && c.branchId === form.branchId && c.name.toLowerCase() === name.toLowerCase())) return setErr('Tên sân đã tồn tại trong chi nhánh này.')
    if (form.description.length > 500) return setErr('Mô tả sân tối đa 500 ký tự.')
    if (form.depositType === 'percent' && !(form.deposit >= 10 && form.deposit <= 100)) return setErr('Tỷ lệ đặt cọc phải nằm trong khoảng 10% – 100%.')
    if (form.depositType === 'fixed' && !(form.deposit > 0)) return setErr('Tiền đặt cọc cố định phải lớn hơn 0.')
    if (form.priceRules.length === 0) return setErr('Cần có ít nhất một khung giá thuê.')
    for (const r of form.priceRules) {
      if (!(r.price > 0)) return setErr('Đơn giá thuê của mỗi khung phải lớn hơn 0.')
      if (!r.start || !r.end || mins(r.end) <= mins(r.start)) return setErr(`Khung giá "${r.label || '—'}": giờ kết thúc phải sau giờ bắt đầu.`)
    }
    const sorted = [...form.priceRules].sort((a, b) => mins(a.start) - mins(b.start))
    for (let i = 1; i < sorted.length; i++) if (mins(sorted[i].start) < mins(sorted[i - 1].end)) return setErr('Các khung giá không được chồng chéo thời gian.')
    const data = { ...form, name, priceRules: sorted }
    if (editId) {
      setCourts((cs) => cs.map((c) => (c.id === editId ? { ...c, ...data } : c)))
      toast(`Đã cập nhật ${name}. Giá & mức cọc mới chỉ áp dụng cho đơn phát sinh sau thời điểm lưu.`, 'ok')
    } else {
      const sp = sportOf(form.sport)
      const n = Math.max(0, ...courts.filter((c) => c.sport === form.sport).map((c) => parseInt(c.id.split('_')[2], 10))) + 1
      setCourts((cs) => [...cs, { ...data, id: `SAN_${sp.code}_${String(n).padStart(2, '0')}` }])
      toast(`Đã thêm sân mới ${name}.`, 'ok')
    }
    reset()
  }

  // ===== Tab 2: giờ mở cửa & ngày nghỉ =====
  const setDay = (idx: number, p: Partial<DayHours>) => setDraft((d) => ({ ...d, [hb]: d[hb].map((h, i) => (i === idx ? { ...h, ...p } : h)) }))
  const saveHours = () => {
    for (const b of branches) for (const [idx, label] of DAYS) {
      const h = draft[b.id][idx]
      if (!h.closed && mins(h.close) <= mins(h.open)) return setHErr(`${b.name} – ${label}: Giờ đóng cửa phải lớn hơn giờ mở cửa.`)
    }
    const ids = new Set<string>()
    for (const b of branches) affectedByHours(bookings, courts, b.id, draft[b.id], TODAY).forEach((x) => ids.add(x.id))
    setHErr('')
    setBranches((bs) => bs.map((b) => ({ ...b, hours: draft[b.id].map((h) => ({ ...h })) })))
    if (ids.size) { flagAffected([...ids], 'Giờ mở cửa chi nhánh thay đổi'); toast(`Đã lưu giờ mở cửa. Phát hiện ${ids.size} đơn bị ảnh hưởng — xử lý ở danh sách bên dưới.`, 'info') }
    else toast('Đã lưu giờ mở cửa các chi nhánh.', 'ok')
  }
  const addHoliday = () => {
    if (!hol.date) return setHolErr('Vui lòng chọn ngày nghỉ.')
    if (hol.date < TODAY) return setHolErr('Không thể thêm ngày nghỉ trong quá khứ.')
    if (!(hol.days >= 1 && hol.days <= 60)) return setHolErr('Số ngày nghỉ liên tiếp phải từ 1 đến 60.')
    const end = addDays(hol.date, hol.days - 1)
    const br = hol.branchId === 'all' ? undefined : hol.branchId
    setHolidays((hs) => [...hs, { id: `H${hs.length + 1}-${hol.date}`, date: hol.date, endDate: end, note: hol.note.trim() || 'Nghỉ lễ', branchId: br }])
    const hit = affectedByHoliday(bookings, courts, hol.date, end, br)
    if (hit.length) { flagAffected(hit.map((x) => x.id), 'Ngày nghỉ lễ của cơ sở'); toast(`Đã thêm ngày nghỉ. Phát hiện ${hit.length} đơn bị ảnh hưởng — xử lý ở danh sách bên dưới.`, 'info') }
    else toast('Đã thêm ngày nghỉ lễ.', 'ok')
    setHol({ date: '', days: 1, branchId: 'all', note: '' }); setHolErr('')
  }

  // ===== Tab 3: khóa sân =====
  const submitLock = () => {
    if (!lk.courtId) return setLkErr('Vui lòng chọn sân cần khóa.')
    if (!lk.from) return setLkErr('Vui lòng chọn thời điểm bắt đầu.')
    if (lk.mode === 'temp' && (!lk.to || lk.to <= lk.from)) return setLkErr('Thời gian kết thúc phải sau thời gian bắt đầu.')
    if (!lk.reason.trim()) return setLkErr('Vui lòng nhập lý do khóa sân.')
    const to = lk.mode === 'stop' ? FOREVER : lk.to
    const hit = affectedByLock(bookings, lk.courtId, lk.from, to)
    setLocks((ls) => [...ls, { id: `L${ls.length + 1}-${lk.courtId}`, courtId: lk.courtId, from: lk.from, to, reason: lk.reason.trim(), mode: lk.mode }])
    setLkErr('')
    const nm = courts.find((c) => c.id === lk.courtId)?.name ?? lk.courtId
    if (hit.length) {
      flagAffected(hit.map((x) => x.id), `${nm} ${lk.mode === 'stop' ? 'ngừng khai thác' : 'tạm khóa bảo trì'}: ${lk.reason.trim()}`)
      toast(`Đã khóa sân. Phát hiện ${hit.length} đơn bị ảnh hưởng — xử lý ở danh sách bên dưới.`, 'info')
    } else toast(lk.mode === 'stop' ? 'Đã chuyển sân sang trạng thái ngừng khai thác.' : 'Đã tạm khóa sân. Các ô giờ trong khoảng này sẽ hiển thị "Bảo trì".', 'ok')
  }

  const tabs: [Tab, string][] = [[1, 'Danh sách sân & Bảng giá thuê'], [2, 'Giờ mở cửa & Lịch nghỉ lễ'], [3, 'Tạm khóa bảo trì sân']]
  const dh = draft[hb] ?? []

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          {tabs.map(([t, l]) => <button key={t} className={`btn btn-md ${tab === t ? 'btn-primary' : 'btn-ghost'}`} style={{ background: tab === t ? undefined : 'var(--s100)', padding: tab === t ? '9px 16px' : '8px 16px' }} onClick={() => setTab(t)}>{l}</button>)}
        </div>
        <span className="t12 w600 c-s600">Tổng số: {courts.length} sân thuộc {branches.length} chi nhánh</span>
      </section>

      {tab === 1 && (
        <div className="grid12">
          <section className="span7 card col g16">
            <div className="row between"><h2 className="t14 w800 c-ink">Danh sách sân & Cấu hình giá theo khung giờ</h2><span className="t12 c-s600">Nhấp "Cập nhật" để điều chỉnh giá hoặc mức cọc</span></div>
            <div className="tbl-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table className="tbl">
                <thead style={{ position: 'sticky', top: 0 }}><tr><th>Mã / Tên sân</th><th>Chi nhánh & Bộ môn</th><th>Đơn giá theo giờ</th><th>Đặt cọc</th><th>Trạng thái</th><th className="r">Thao tác</th></tr></thead>
                <tbody>
                  {list.map((c) => {
                    const l = lockOf(c.id)
                    return (
                      <tr key={c.id} className={l ? 'warn-row' : editId === c.id ? 'hl' : ''}>
                        <td><div className="mono w800" style={{ fontSize: 11.1 }}>{c.id}</div><div className="w700 c-s800">{c.name}</div></td>
                        <td><div className="w700 c-brand8">{bName(c.branchId)}</div><div className="c-s600">{sportOf(c.sport).detail}</div></td>
                        <td>{c.priceRules.map((r) => <div key={r.start}>{r.start.slice(0, 2)}h-{r.end.slice(0, 2)}h: <b>{fmt(r.price)}đ/h</b></div>)}</td>
                        <td><b className="w800">{c.depositType === 'percent' ? `${c.deposit}%` : `${fmt(c.deposit)}đ`}</b></td>
                        <td>{!c.active ? <span className="badge b-gray">Ngừng hoạt động</span> : l ? <span className="badge" style={{ background: 'var(--amber-200)', color: 'var(--amber-950)' }}>{l.mode === 'stop' ? 'Ngừng khai thác' : 'Đang bảo trì'}</span> : <span className="badge b-green">Đang mở</span>}</td>
                        <td className="r"><div className="col g6" style={{ alignItems: 'flex-end' }}>
                          <button className="btn btn-outline btn-sm" style={{ color: 'var(--brand-800)' }} onClick={() => edit(c)}>Cập nhật</button>
                          {l && <button className="btn btn-warn-o btn-sm" onClick={() => { setLocks((ls) => ls.filter((x) => x.courtId !== c.id)); toast(`Đã mở lại ${c.name}.`, 'ok') }}>Mở lại sân</button>}
                        </div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="hint hint-green" style={{ padding: 14 }}>💡 Khi thay đổi bảng giá thuê hoặc mức đặt cọc, mức giá mới sẽ áp dụng cho các đơn đặt sân phát sinh sau thời điểm lưu; các đơn khách đã đặt trước đó vẫn được giữ nguyên mức giá và tiền cọc ban đầu.</div>
          </section>

          <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
            <div className="row between head-rule">
              <div className="col" style={{ gap: 1.5, paddingTop: 5.5 }}><span className="eyebrow">Thông tin sân thi đấu</span><h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>{editId ? 'Chỉnh sửa sân' : 'Thêm sân mới'}</h3></div>
              <span className="badge sq b-gray mono" style={{ fontSize: 11.3, fontWeight: 800, color: 'var(--s900)' }}>{editId ?? 'SAN_MỚI'}</span>
            </div>
            <form noValidate className="col g14" onSubmit={(e) => { e.preventDefault(); save() }}>
              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="f1"><label className="label" style={{ marginBottom: 4 }}>Tên sân thi đấu *</label><input className="input sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="f1"><label className="label" style={{ marginBottom: 4 }}>Thuộc chi nhánh *</label>
                  <select className="select sm" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              </div>
              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="f1"><label className="label" style={{ marginBottom: 4 }}>Bộ môn thể thao *</label>
                  <select className="select sm" value={form.sport} disabled={!!editId} onChange={(e) => setForm({ ...form, sport: e.target.value as SportKey })}>{SPORTS.map((s) => <option key={s.key} value={s.key}>{s.detail}</option>)}</select></div>
                <div className="f1"><label className="label" style={{ marginBottom: 4 }}>Hình thức đặt cọc *</label>
                  <select className="select sm" value={form.depositType} onChange={(e) => setForm({ ...form, depositType: e.target.value as 'percent' | 'fixed', deposit: e.target.value === 'percent' ? 30 : 100000 })}><option value="percent">Theo tỷ lệ %</option><option value="fixed">Số tiền cố định (VNĐ)</option></select></div>
              </div>
              <div><label className="label" style={{ marginBottom: 4 }}>{form.depositType === 'percent' ? 'Tỷ lệ đặt cọc giữ sân (10% – 100%) *' : 'Số tiền đặt cọc cố định (VNĐ) *'}</label>
                <input data-testid="court-deposit" className="input sm" style={{ color: 'var(--brand-700)', fontWeight: 800 }} type="number" min={form.depositType === 'percent' ? 10 : 1} max={form.depositType === 'percent' ? 100 : undefined} step={form.depositType === 'percent' ? 1 : 1000} value={form.deposit} onChange={(e) => setForm({ ...form, deposit: Number(e.target.value) })} /></div>
              <div><label className="label" style={{ marginBottom: 4 }}>Mô tả sân (tối đa 500 ký tự)</label>
                <textarea data-testid="court-desc" className="input sm" rows={2} maxLength={500} style={{ fontWeight: 500 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                <span className="t11 c-s500">{form.description.length}/500</span></div>
              <div className="col g8" style={{ paddingTop: 4 }}>
                <div className="row between"><label className="label" style={{ margin: 0 }}>Bảng giá thuê theo khung giờ (VNĐ/giờ) *</label>
                  <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, priceRules: [...f.priceRules, { label: 'Khung mới', start: '05:00', end: '06:00', price: 100000 }] }))}>+ Thêm khung giá</button></div>
                <div className="col g8" style={{ background: 'var(--s100)', border: '1px solid var(--s300)', borderRadius: 12, padding: 12 }}>
                  {form.priceRules.map((r, i) => (
                    <div key={i} className="row g6" style={{ alignItems: 'center' }}>
                      <input className="input sm" style={{ width: 92 }} value={r.label} aria-label={`Tên khung giá ${i + 1}`} onChange={(e) => setRule(i, { label: e.target.value })} />
                      <input className="input sm" style={{ width: 86 }} type="time" aria-label={`Giờ bắt đầu khung ${i + 1}`} value={r.start} onChange={(e) => setRule(i, { start: e.target.value })} />
                      <input className="input sm" style={{ width: 86 }} type="time" aria-label={`Giờ kết thúc khung ${i + 1}`} value={r.end === '24:00' ? '23:59' : r.end} onChange={(e) => setRule(i, { end: e.target.value === '23:59' ? '24:00' : e.target.value })} />
                      <input className="input sm bold" type="number" min={0} step={1000} aria-label={`Đơn giá khung ${i + 1}`} value={r.price} onChange={(e) => setRule(i, { price: Number(e.target.value) })} />
                      <button type="button" className="btn btn-danger-o btn-xs" aria-label={`Xóa khung giá ${i + 1}`} onClick={() => setForm((f) => ({ ...f, priceRules: f.priceRules.filter((_, j) => j !== i) }))}>×</button>
                    </div>
                  ))}
                </div>
              </div>
              <div><label className="label" style={{ marginBottom: 4 }}>Trạng thái nhận lịch</label>
                <select className="select sm" value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}><option value="1">Đang hoạt động</option><option value="0">Ngừng hoạt động</option></select></div>
              {err && <p className="field-err">{err}</p>}
              <div className="row g8"><button className="btn btn-primary btn-md f1" type="submit">Lưu thông tin sân</button>{editId && <button className="btn btn-outline btn-md" type="button" onClick={reset}>Thêm sân mới</button>}</div>
            </form>
          </aside>
        </div>
      )}

      {tab === 2 && (
        <div className="grid12">
          <section className="span7 card col g16">
            <div className="row between wrap g12">
              <div className="col g2"><h2 className="t14 w800 c-ink">Giờ mở cửa theo từng thứ trong tuần</h2><span className="t12 c-s600">Khung giờ này quyết định bảng lịch khách có thể đặt trực tuyến & tại quầy.</span></div>
              <select className="select sm fit" value={hb} onChange={(e) => setHb(e.target.value)} aria-label="Chi nhánh cấu hình giờ">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </div>
            <div className="col g8">
              {DAYS.map(([idx, label]) => (
                <div key={idx} className="row between g12 wrap hint" style={{ padding: 10, opacity: dh[idx]?.closed ? 0.6 : 1 }}>
                  <b className="t12 c-ink" style={{ width: 80 }}>{label}</b>
                  <div className="row g8">
                    <input type="time" className="input sm" style={{ width: 'auto' }} disabled={dh[idx]?.closed} value={dh[idx]?.open ?? ''} onChange={(e) => setDay(idx, { open: e.target.value })} />
                    <span className="t12 c-s600">đến</span>
                    <input type="time" className="input sm" style={{ width: 'auto' }} disabled={dh[idx]?.closed} value={dh[idx]?.close ?? ''} onChange={(e) => setDay(idx, { close: e.target.value })} />
                  </div>
                  <label className="row g6 t12 c-s700" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!dh[idx]?.closed} onChange={(e) => setDay(idx, { closed: e.target.checked })} /> Nghỉ cả ngày</label>
                </div>
              ))}
            </div>
            {hErr && <p className="field-err">{hErr}</p>}
            <div className="row g8">
              <button className="btn btn-primary btn-md" onClick={saveHours}>Lưu giờ mở cửa</button>
              <button className="btn btn-outline btn-md" onClick={() => setDraft((d) => ({ ...d, [hb]: d[hb].map(() => ({ ...d[hb][1] })) }))}>Áp dụng giờ Thứ Hai cho cả tuần</button>
            </div>
            <div className="col g8 top-rule" style={{ paddingTop: 12 }}>
              <b className="t12 c-ink">Đơn đặt sân bị ảnh hưởng cần xử lý (UC 021)</b>
              <AffectedBookingsModal list={affected} emptyText="Không có đơn nào bị ảnh hưởng bởi thay đổi lịch vận hành." />
            </div>
          </section>
          <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
            <div className="col head-rule" style={{ gap: 2 }}><span className="eyebrow">Lịch nghỉ lễ</span><h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Ngày đóng cửa (theo khoảng ngày)</h3></div>
            <div className="col g8">
              {holidays.length === 0 && <p className="t12 c-s600">Chưa có ngày nghỉ lễ nào.</p>}
              {holidays.map((h) => (
                <div key={h.id} className="row between hint" style={{ padding: 12 }}><div className="col"><b className="c-ink">{h.date === h.endDate ? toVN(h.date) : `${toVN(h.date)} → ${toVN(h.endDate)}`}</b><span>{h.note}</span><span className="t11 c-s500">{h.branchId ? bName(h.branchId) : 'Toàn hệ thống'}</span></div>
                  <button className="btn btn-danger-o btn-xs" onClick={() => setHolidays((hs) => hs.filter((x) => x.id !== h.id))}>Xóa</button></div>
              ))}
            </div>
            <form noValidate className="col g10" onSubmit={(e) => { e.preventDefault(); addHoliday() }}>
              <div className="row g8"><input className="input sm" type="date" min={TODAY} value={hol.date} aria-label="Từ ngày" onChange={(e) => setHol({ ...hol, date: e.target.value })} />
                <input className="input sm" type="number" min={1} max={60} style={{ width: 90 }} aria-label="Số ngày nghỉ liên tiếp" title="Số ngày nghỉ liên tiếp" value={hol.days} onChange={(e) => setHol({ ...hol, days: Number(e.target.value) })} /></div>
              <p className="t11 c-s600">{hol.date ? `Nghỉ ${hol.days} ngày liên tiếp: từ ${toVN(hol.date)} đến ${toVN(addDays(hol.date, Math.max(1, hol.days) - 1))}` : 'Chọn ngày bắt đầu và số ngày nghỉ liên tiếp (khoảng Từ ngày – Đến ngày).'}</p>
              <select className="select sm" value={hol.branchId} onChange={(e) => setHol({ ...hol, branchId: e.target.value })} aria-label="Phạm vi chi nhánh"><option value="all">Toàn hệ thống</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              <input className="input sm" style={{ fontWeight: 500 }} placeholder="Ghi chú (vd: Nghỉ Tết)" value={hol.note} onChange={(e) => setHol({ ...hol, note: e.target.value })} />
              {holErr && <p className="field-err">{holErr}</p>}
              <button className="btn btn-primary btn-md">+ Thêm ngày nghỉ</button>
            </form>
          </aside>
        </div>
      )}

      {tab === 3 && (
        <div className="grid12">
          <section className="span7 card col g16">
            <div className="col g2"><h2 className="t14 w800 c-ink">Các sân đang tạm khóa bảo trì / ngừng khai thác</h2><span className="t12 c-s600">Sân bị khóa sẽ không nhận lịch đặt trong khoảng thời gian bảo trì.</span></div>
            {locks.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Hiện không có sân nào đang bảo trì.</div>}
            {locks.map((l) => {
              const c = courts.find((x) => x.id === l.courtId)
              return (
                <div key={l.id} className="row between g12" style={{ background: 'var(--amber-50)', border: '2px solid var(--amber-400)', borderRadius: 12, padding: 14 }}>
                  <div className="col g2"><b className="t12 c-ink">{c?.name} • {c && bName(c.branchId)}</b><span className="t12 c-s700">{l.mode === 'stop' ? `Từ ${dt(l.from)} • Ngừng khai thác không thời hạn` : `${dt(l.from)} → ${dt(l.to)}`}</span><span className="t11 c-amber">{l.reason}</span></div>
                  <button className="btn btn-warn-o btn-sm" onClick={() => { setLocks((ls) => ls.filter((x) => x.id !== l.id)); toast(`Đã mở lại ${c?.name}.`, 'ok') }}>Mở lại sân</button>
                </div>
              )
            })}
            <div className="col g8 top-rule" style={{ paddingTop: 12 }}>
              <b className="t12 c-ink">⚠️ Đơn đặt sân bị ảnh hưởng cần xử lý (UC 021)</b>
              <AffectedBookingsModal list={affected} emptyText="Chưa có đơn nào bị ảnh hưởng." />
            </div>
          </section>
          <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
            <div className="col head-rule" style={{ gap: 2 }}><span className="eyebrow" style={{ color: 'var(--amber-800)' }}>Tạm khóa sân</span><h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Lên lịch bảo trì / ngừng khai thác</h3></div>
            <form noValidate className="col g14" onSubmit={(e) => { e.preventDefault(); submitLock() }}>
              <div className="row g8">
                {([['temp', 'lock-mode-temp', 'Tạm khóa bảo trì'], ['stop', 'lock-mode-stop', 'Ngừng khai thác']] as const).map(([k, tid, l]) => (
                  <label key={k} className={`radio-card f1${lk.mode === k ? ' on' : ''}`}><input type="radio" name="lockmode" data-testid={tid} checked={lk.mode === k} onChange={() => setLk({ ...lk, mode: k })} />{l}</label>
                ))}
              </div>
              <div><label className="label" style={{ marginBottom: 4 }}>Sân cần khóa *</label>
                <select className="select sm" value={lk.courtId} onChange={(e) => setLk({ ...lk, courtId: e.target.value })}>
                  <option value="">— Chọn sân —</option>
                  {courts.filter((c) => branchFilter === 'all' || c.branchId === branchFilter).map((c) => <option key={c.id} value={c.id}>{c.name} – {bName(c.branchId)}</option>)}
                </select></div>
              <div className="row g12"><div className="f1"><label className="label" style={{ marginBottom: 4 }}>Từ *</label><input className="input sm" type="datetime-local" value={lk.from} onChange={(e) => setLk({ ...lk, from: e.target.value })} /></div>
                {lk.mode === 'temp' && <div className="f1"><label className="label" style={{ marginBottom: 4 }}>Đến *</label><input className="input sm" type="datetime-local" value={lk.to} onChange={(e) => setLk({ ...lk, to: e.target.value })} /></div>}</div>
              {lk.mode === 'stop' && <p className="t11 c-s600">Ngừng khai thác không thời hạn cho đến khi Chủ sân mở lại.</p>}
              <div><label className="label" style={{ marginBottom: 4 }}>Lý do {lk.mode === 'stop' ? 'ngừng khai thác' : 'bảo trì'} *</label><input className="input sm" style={{ fontWeight: 500 }} value={lk.reason} onChange={(e) => setLk({ ...lk, reason: e.target.value })} /></div>
              {lkErr && <p className="field-err">{lkErr}</p>}
              <button className="btn btn-danger btn-md">{lk.mode === 'stop' ? 'Ngừng khai thác sân' : 'Tạm khóa sân'}</button>
            </form>
          </aside>
        </div>
      )}
    </>
  )
}
