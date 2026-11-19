import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { SPORTS } from '../data'
import type { Promo, SportKey } from '../data'
import type { StaffOutlet } from '../layouts'
import { useApp } from '../appContext'
import { promoSummary } from '../domain/pricing'
import { computeRevenueReport } from '../domain/reports'
import type { ReportRow } from '../domain/reports'
import { fmt, money, toVN } from '../utils/format'

const MONTH = { from: '2026-11-01', to: '2026-11-30' }
const FRAMES: [string, number, number][] = [['Cả ngày (05:00 - 23:00)', 0, 24], ['06:00 - 11:00', 6, 11], ['10:00 - 15:00', 10, 15], ['15:00 - 22:00', 15, 22]]
const LEVELS = [['5|0', 'Giảm 5%'], ['10|0', 'Giảm 10%'], ['15|0', 'Giảm 15%'], ['20|100000', 'Giảm 20% (Tối đa 100k)'], ['25|150000', 'Giảm 25% (Tối đa 150k)'], ['30|200000', 'Giảm 30% (Tối đa 200k)']]
const empty = { name: '', code: '', type: 'percent' as 'percent' | 'fixed', level: '10|0', fixed: 50000, branchId: 'all', sport: 'all' as 'all' | SportKey, frame: 0, customFrom: 6, customTo: 11, start: MONTH.from, end: MONTH.to, limit: 100, audience: 'all' as 'all' | 'specific', phones: '', notify: true }

const tr = (n: number) => `${(n / 1e6).toFixed(2).replace('.', ',').replace(/,?0+$/, '') || '0'}Tr`

export default function OwnerReports() {
  const { branches, courts, bookings, holidays, transactions, promos, setPromos, pushNotification, toast } = useApp()
  const { branchFilter } = useOutletContext<StaffOutlet>()
  const [from, setFrom] = useState(MONTH.from)
  const [to, setTo] = useState(MONTH.to)
  const [applied, setApplied] = useState(MONTH)
  const [courtId, setCourtId] = useState('all')
  const [editCode, setEditCode] = useState<string | null>(null)
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState('')

  const courtOpts = courts.filter((c) => branchFilter === 'all' || c.branchId === branchFilter)
  const cid = courtOpts.some((c) => c.id === courtId) ? courtId : 'all'
  const rep = computeRevenueReport({ bookings, courts, branches, holidays, txs: transactions, from: applied.from, to: applied.to, branchId: branchFilter, courtId: cid })
  const t = rep.total
  const pct = (n: number) => (t.orders ? `${((n / t.orders) * 100).toFixed(1).replace('.', ',')}%` : '0%')
  const branchLabel = branchFilter === 'all' ? `Tất cả chi nhánh (${branches.length} cơ sở)` : branches.find((b) => b.id === branchFilter)?.name

  const edit = (p: Promo) => {
    setEditCode(p.code); setErr('')
    const fi = FRAMES.findIndex(([, a, b]) => a === p.fromHour && b === p.toHour)
    setForm({
      name: p.name, code: p.code, type: p.discountType, level: `${p.percent}|${p.maxOff ?? 0}`, fixed: p.fixedOff || 50000, branchId: p.branchId ?? 'all',
      sport: p.sports?.length === 1 ? p.sports[0] : 'all', frame: fi >= 0 ? fi : -1, customFrom: p.fromHour, customTo: p.toHour, start: p.start, end: p.end, limit: p.limit,
      audience: p.targetAudience, phones: p.targetPhones.join(', '), notify: p.notified,
    })
  }
  const reset = () => { setEditCode(null); setForm(empty); setErr('') }
  const remove = (p: Promo) => {
    if (p.used === 0) { setPromos((ps) => ps.filter((x) => x.code !== p.code)); toast(`Đã xóa mã ${p.code} (chưa có lượt sử dụng).`, 'ok') }
    else { setPromos((ps) => ps.map((x) => (x.code === p.code ? { ...x, status: 'discontinued' } : x))); toast(`Mã ${p.code} đã có ${p.used} lượt sử dụng nên chuyển sang Ngừng áp dụng.`, 'ok') }
    if (editCode === p.code) reset()
  }

  const save = () => {
    const code = form.code.trim().toUpperCase()
    const name = form.name.trim()
    if (name.length < 5 || name.length > 150) return setErr('Tên chương trình ưu đãi phải từ 5 đến 150 ký tự.')
    if (!/^[A-Z0-9]{4,20}$/.test(code)) return setErr('Mã giảm giá gồm 4–20 ký tự chữ hoa hoặc số, không dấu.')
    if (!editCode && promos.some((p) => p.code === code)) return setErr('Mã giảm giá này đã tồn tại.')
    if (editCode && code !== editCode && promos.some((p) => p.code === code)) return setErr('Mã giảm giá này đã tồn tại.')
    if (!form.start || !form.end || form.end < form.start) return setErr('Khoảng ngày áp dụng không hợp lệ.')
    if (!(form.limit > 0)) return setErr('Số lượt dùng phải lớn hơn 0.')
    if (form.type === 'fixed' && !(form.fixed > 0)) return setErr('Số tiền giảm phải lớn hơn 0.')
    const [fh, th] = form.frame >= 0 ? [FRAMES[form.frame][1], FRAMES[form.frame][2]] : [form.customFrom, form.customTo]
    if (!(fh >= 0 && th <= 24 && fh < th)) return setErr('Khung giờ tùy chỉnh không hợp lệ (giờ bắt đầu phải nhỏ hơn giờ kết thúc, trong 0–24).')
    const phones = form.phones.split(/[,\s]+/).filter(Boolean)
    if (form.audience === 'specific') {
      if (!phones.length) return setErr('Vui lòng nhập ít nhất một số điện thoại khách hàng được áp dụng.')
      if (phones.some((p) => !/^0\d{9}$/.test(p))) return setErr('Danh sách số điện thoại khách hàng không hợp lệ (mỗi số 10 chữ số, cách nhau bằng dấu phẩy).')
    }
    const [pc, mx] = form.level.split('|').map(Number)
    const br = branches.find((b) => b.id === form.branchId)
    const spName = form.sport === 'all' ? '' : SPORTS.find((s) => s.key === form.sport)?.label
    const base: Omit<Promo, 'used'> = {
      code, name, discountType: form.type, percent: form.type === 'percent' ? pc : 0, fixedOff: form.type === 'fixed' ? form.fixed : 0, maxOff: form.type === 'percent' ? mx || null : null,
      fromHour: fh, toHour: th, scope: `${br ? br.name : 'Tất cả cơ sở'}${spName ? ` • ${spName}` : ''}`, start: form.start, end: form.end, limit: form.limit,
      status: 'active', notified: form.notify, branchId: br?.id, sports: form.sport === 'all' ? undefined : [form.sport],
      targetAudience: form.audience, targetPhones: form.audience === 'specific' ? phones : [], tag: 'Ưu đãi mới', tone: 'green',
    }
    if (editCode) setPromos((ps) => ps.map((p) => (p.code === editCode ? { ...p, ...base, status: p.status, tag: p.tag, tone: p.tone } : p)))
    else setPromos((ps) => [{ ...base, used: 0 }, ...ps])
    if (form.notify) {
      const sum = promoSummary({ ...base, used: 0 } as Promo)
      const body = `Nhập mã ${code} để được giảm ${sum} tiền thuê sân${fh > 0 || th < 24 ? ` khung ${String(fh).padStart(2, '0')}:00 – ${String(th).padStart(2, '0')}:00` : ''}, áp dụng từ ${toVN(form.start)} đến ${toVN(form.end)}.`
      const targets = form.audience === 'all' ? ['ALL'] : phones
      for (const to of targets) pushNotification({ to, type: 'PROMO', title: `🎁 ${name}`, body, promoCode: code })
    }
    toast(`${editCode ? 'Đã cập nhật' : 'Đã phát hành'} mã ${code}${form.notify ? ' và gửi thông báo cho khách hàng' : ''}.`, 'ok')
    reset()
  }

  const cols = ['Tổng số đơn', 'Hoàn thành', 'Đơn hủy (Giữ cọc)', 'Công suất sân', 'Thu từ đơn hoàn thành', 'Thu từ đơn hủy', 'Tổng thực thu']
  const cells = (r: ReportRow) => (
    <>
      <td className="r w700">{fmt(r.orders)}</td><td className="r w700 c-brand8">{fmt(r.done)}</td><td className="r w700 c-rose">{fmt(r.cancelled)}</td>
      <td className="r w800 c-brand8">{r.capHours ? `${r.occ}%` : '—'}</td><td className="r w700">{money(r.fromDone)}</td><td className="r w700">{money(r.fromCancel)}</td><td className="r w800 c-ink">{money(r.total)}</td>
    </>
  )

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g12 wrap">
          <span className="t12 w700 c-s700">Kỳ báo cáo:</span>
          <input type="date" className="input sm" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="t12 w600 c-s600">đến</span>
          <input type="date" className="input sm" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} />
          <span className="chip-box" style={{ borderRadius: 8, background: 'var(--s50)' }}>{branchLabel}</span>
          <select data-testid="report-court-filter" className="select sm fit" style={{ background: 'var(--s50)' }} value={cid} onChange={(e) => setCourtId(e.target.value)}>
            <option value="all">Tất cả sân</option>
            {courtOpts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
          </select>
          <button className="btn btn-primary btn-md" style={{ padding: '8px 16px' }} onClick={() => { if (!from || !to || to < from) return toast('Ngày kết thúc phải sau ngày bắt đầu.', 'err'); setApplied({ from, to }); toast('Đã cập nhật báo cáo theo bộ lọc.') }}>Lọc dữ liệu</button>
        </div>
        <span className="t12 c-s600">Dữ liệu tính trực tiếp từ đơn đặt sân & giao dịch</span>
      </section>

      {rep.empty && <div className="hint" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber-300)', color: 'var(--amber-900)', textAlign: 'center', padding: 16 }}>Không có dữ liệu phát sinh trong khoảng thời gian đã chọn.</div>}

      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <div className="hero col g8" style={{ padding: 20, borderRadius: 16, flex: 1.15 }}>
          <span className="t12 w700" style={{ color: 'var(--brand-100)' }}>Tổng doanh thu thực thu ({applied.from === MONTH.from && applied.to === MONTH.to ? 'Tháng 11' : `${toVN(applied.from)} – ${toVN(applied.to)}`})</span>
          <div className="t24 w800" style={{ fontSize: 28, lineHeight: '36px' }}>{fmt(t.total)} VNĐ</div>
          <p className="t12" style={{ color: 'var(--brand-100)' }}>Chuyển khoản QR: {tr(t.qr)} ({t.total ? ((t.qr / t.total) * 100).toFixed(1).replace('.', ',') : '0'}%) • Tiền mặt: {tr(t.cash)}</p>
        </div>
        <div className="card col g8 f1" style={{ borderRadius: 16 }}>
          <span className="t12 w700 c-s600">Chi tiết nguồn doanh thu</span>
          <Row k="• Đơn đã hoàn thành:" v={money(t.fromDone)} c="c-ink" /><Row k="• Tiền thu lịch sắp chơi:" v={money(t.fromUpcoming)} c="c-brand" /><Row k="• Tiền cọc đơn hủy giữ lại:" v={money(t.fromCancel)} c="c-amber" />
          <span className="t11 c-s500">Đơn đóng do cơ sở ({t.facility}) không tính vào doanh thu.</span>
        </div>
        <div className="card col g8 f1" style={{ borderRadius: 16 }}>
          <span className="t12 w700 c-s600">Tỷ lệ lượt đặt sân ({fmt(t.orders)} đơn)</span>
          <Row k="• Hoàn thành:" v={`${fmt(t.done)} đơn (${pct(t.done)})`} c="c-brand8" /><Row k="• Khách hủy / Quá giờ:" v={`${fmt(t.cancelled)} đơn (${pct(t.cancelled)})`} c="c-rose" /><Row k="• Hết hạn giữ chỗ:" v={`${fmt(t.expired)} đơn (${pct(t.expired)})`} c="c-amber" />
        </div>
        <div className="card col g8 f1" style={{ borderRadius: 16 }}>
          <span className="t12 w700 c-s600">Hiệu quả chương trình ưu đãi</span>
          <div className="t24 w800 c-ink" style={{ fontSize: 22 }}>{rep.promoOrders} đơn dùng mã</div>
          <div className="t11 c-s600">Tổng giảm: <b className="c-rose">{tr(rep.promoDiscount)}</b> • Doanh thu: <b className="c-brand">{tr(rep.promoRevenue)}</b></div>
        </div>
      </div>

      <section className="card card-lg col g16" style={{ padding: 20 }}>
        <div className="row between"><h2 className="t14 w800 c-ink">Bảng tổng hợp doanh thu & tỷ lệ lấp đầy theo từng chi nhánh</h2><span className="t12 c-s600">Kỳ: {toVN(applied.from)} – {toVN(applied.to)}</span></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Chi nhánh</th>{cols.map((h) => <th key={h} className="r">{h}</th>)}</tr></thead>
            <tbody>
              {rep.byBranch.map((r) => <tr key={r.key}><td className="w700 c-ink" style={{ fontSize: 12 }}>{r.label} ({r.courts} sân)</td>{cells(r)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-lg col g16" style={{ padding: 20 }}>
        <div className="row between"><h2 className="t14 w800 c-ink">So sánh chi tiết theo từng sân</h2><span className="t12 c-s600">{rep.byCourt.length} sân trong bộ lọc</span></div>
        <div className="tbl-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="tbl" data-testid="report-by-court-table">
            <thead><tr><th>Sân</th>{cols.map((h) => <th key={h} className="r">{h}</th>)}</tr></thead>
            <tbody>
              {rep.byCourt.map((r) => <tr key={r.key}><td className="w700 c-ink" style={{ fontSize: 12 }}>{r.label}<div className="t11 c-s500 mono">{r.key}</div></td>{cells(r)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid12">
        <section className="span7 card card-lg col g16" style={{ padding: 20 }}>
          <div className="col g2"><h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Chương trình khuyến mãi & Mã giảm giá</h2><p className="t12 c-s600">Gồm cả mã áp dụng tại quầy. Mã đã có lượt dùng sẽ chuyển sang Ngừng áp dụng khi xóa.</p></div>
          {promos.map((p) => (
            <div key={p.code} data-testid={`promo-card-${p.code}`} className="row between g12" style={{ background: p.status === 'active' ? 'var(--s50)' : 'var(--s100)', border: '1px solid var(--s300)', borderRadius: 12, padding: 16, opacity: p.status === 'active' ? 1 : 0.8 }}>
              <div className="col g6 f1">
                <div className="row g8 wrap"><span className="badge sq c-white mono" style={{ background: p.tone === 'sky' ? '#0369a1' : 'var(--brand-800)', fontSize: 11 }}>{p.code}</span>
                  <b className="t14 c-ink">{p.name}</b>
                  <span className={`badge ${p.status === 'active' ? 'b-green-flat' : 'b-gray'}`} style={{ padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>{p.status === 'active' ? 'Đang chạy' : p.status === 'paused' ? 'Tạm dừng' : 'Ngừng áp dụng'}</span>
                  {p.counterOnly && <span className="badge b-sky" style={{ padding: '2px 10px', fontSize: 10 }}>Tại quầy</span>}</div>
                <p className="t11 c-s700">Giảm: <b className="c-brand8">{promoSummary(p)}</b> • {p.scope}{p.fromHour > 0 || p.toHour < 24 ? ` | Khung ${String(p.fromHour).padStart(2, '0')}:00 - ${String(p.toHour).padStart(2, '0')}:00` : ' & Mọi khung giờ'} • {toVN(p.start)} - {toVN(p.end)}{p.targetAudience === 'specific' ? ` • Dành cho ${p.targetPhones.length} khách chỉ định` : ''}</p>
                <p className="t11 c-s700">Lượt sử dụng: <b>{p.used} / {p.limit} lượt</b>{p.notified ? ' • Đã gửi thông báo cho hội viên' : ''}</p>
              </div>
              <div className="row g8">
                {p.status !== 'discontinued' && <button className="btn btn-outline btn-sm" style={{ color: 'var(--s800)' }} onClick={() => edit(p)}>Chỉnh sửa</button>}
                {p.status !== 'discontinued' && <button className={`btn btn-sm ${p.status === 'active' ? 'btn-warn-o' : 'btn-green-o'}`} onClick={() => { setPromos((ps) => ps.map((x) => (x.code === p.code ? { ...x, status: x.status === 'active' ? 'paused' : 'active' } : x))); toast(p.status === 'active' ? `Đã tạm dừng mã ${p.code}.` : `Mã ${p.code} đã chạy lại.`) }}>{p.status === 'active' ? 'Tạm dừng' : 'Chạy lại'}</button>}
                {p.status !== 'discontinued' && <button className="btn btn-danger-o btn-sm" data-testid={`promo-delete-${p.code}`} onClick={() => remove(p)}>Xóa</button>}
              </div>
            </div>
          ))}
        </section>

        <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
          <div className="col head-rule" style={{ gap: 2, paddingTop: 5 }}><span className="eyebrow">{editCode ? `Chỉnh sửa chương trình ${editCode}` : 'Tạo chương trình mới'}</span><h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Phát hành mã giảm giá & Gửi thông báo</h3></div>
          <form noValidate className="col g12" onSubmit={(e) => { e.preventDefault(); save() }}>
            <div data-testid="promo-discount-type" className="row g8">
              {([['percent', 'Giảm theo %'], ['fixed', 'Giảm số tiền (VNĐ)']] as const).map(([k, l]) => (
                <label key={k} className={`radio-card f1${form.type === k ? ' on' : ''}`}><input type="radio" name="dtype" checked={form.type === k} onChange={() => setForm({ ...form, type: k })} />{l}</label>
              ))}
            </div>
            <F l="Tên chương trình ưu đãi *"><input className="input sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Ưu đãi khung giờ vàng buổi sáng" /></F>
            <div className="row g12">
              <div className="f1"><F l="Mã giảm giá *"><input className="input sm" style={{ color: 'var(--brand-700)', fontWeight: 800 }} value={form.code} disabled={!!editCode && (promos.find((p) => p.code === editCode)?.used ?? 0) > 0} placeholder="SANGVUI20" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></F></div>
              <div className="f1">{form.type === 'percent'
                ? <F l="Mức giảm giá *"><select className="select sm" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></F>
                : <F l="Số tiền giảm (VNĐ) *"><input data-testid="promo-fixed-amount" className="input sm" type="number" min={1000} step={1000} value={form.fixed} onChange={(e) => setForm({ ...form, fixed: Number(e.target.value) })} /></F>}</div>
            </div>
            <div className="row g12">
              <div className="f1"><F l="Chi nhánh áp dụng *"><select className="select sm" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="all">Tất cả chi nhánh</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></F></div>
              <div className="f1"><F l="Loại sân áp dụng"><select className="select sm" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value as 'all' | SportKey })}><option value="all">Tất cả loại sân</option>{SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></F></div>
            </div>
            <div className="row g12">
              <div className="f1"><F l="Khung giờ áp dụng *"><select className="select sm" value={form.frame} onChange={(e) => setForm({ ...form, frame: Number(e.target.value) })}>{FRAMES.map(([l], i) => <option key={l} value={i}>{l}</option>)}<option value={-1}>Tùy chỉnh…</option></select></F></div>
              <div className="f1"><F l="Đối tượng khách hàng"><select className="select sm" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as 'all' | 'specific' })}><option value="all">Tất cả khách hàng</option><option value="specific">Khách hàng chỉ định</option></select></F></div>
            </div>
            {form.frame === -1 && (
              <div className="row g12">
                <div className="f1"><F l="Từ giờ (0–24)"><input className="input sm" type="number" min={0} max={24} value={form.customFrom} onChange={(e) => setForm({ ...form, customFrom: Number(e.target.value) })} /></F></div>
                <div className="f1"><F l="Đến giờ (0–24)"><input className="input sm" type="number" min={0} max={24} value={form.customTo} onChange={(e) => setForm({ ...form, customTo: Number(e.target.value) })} /></F></div>
              </div>
            )}
            {form.audience === 'specific' && <F l="Số điện thoại khách hàng (cách nhau bằng dấu phẩy)"><input className="input sm" placeholder="0987654321, 0918223344" value={form.phones} onChange={(e) => setForm({ ...form, phones: e.target.value })} /></F>}
            <div className="row g12">
              <div className="f1"><F l="Từ ngày *"><input className="input sm" type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></F></div>
              <div className="f1"><F l="Đến ngày *"><input className="input sm" type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></F></div>
              <div className="f1"><F l="Số lượt dùng *"><input className="input sm" type="number" min={1} value={form.limit} onChange={(e) => setForm({ ...form, limit: Number(e.target.value) })} /></F></div>
            </div>
            <label className="row g10 hint hint-green" style={{ padding: 12, cursor: 'pointer', background: 'var(--brand-50)' }}>
              <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} style={{ accentColor: '#0075ff', width: 14, height: 14 }} />
              <span className="w700 c-ink">Gửi thông báo chương trình ưu đãi này tới khách hàng</span>
            </label>
            {err && <p className="field-err">{err}</p>}
            <div className="row g8"><button className="btn btn-primary btn-md f1" type="submit">{editCode ? 'Lưu thay đổi' : 'Lưu & Phát hành ưu đãi'}</button>{editCode && <button className="btn btn-outline btn-md" type="button" onClick={reset}>Hủy sửa</button>}</div>
          </form>
        </aside>
      </div>
    </>
  )
}

function Row({ k, v, c }: { k: string; v: string; c: string }) {
  return <div className="row between g8 t11" style={{ fontSize: 11.5 }}><b className="c-ink" style={{ fontWeight: 700 }}>{k}</b><b className={c}>{v}</b></div>
}
function F({ l, children }: { l: string; children: React.ReactNode }) {
  return <div><label className="label" style={{ marginBottom: 4 }}>{l}</label>{children}</div>
}
