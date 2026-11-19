import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FRAMES, HOLD_MINUTES, SPORTS, TODAY } from '../data'
import type { Court, Lock, SportKey } from '../data'
import { useApp } from '../appContext'
import { depositFor, depositIsFull, depositLabel, evalPromo, promoActive, promoSummary, rateAt, slotPrice, slotsHours, slotsPrice } from '../domain/pricing'
import { holidayOn, slotsFor, toggleSelection } from '../domain/slots'
import { dow, hh, kfmt, money, toVN, vnd } from '../utils/format'

export default function Booking() {
  const { courts, branches, promos, blocker, lockAt, holidays, createBooking, peekOrderId, user, toast } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const [sp] = useSearchParams()

  const [branchId, setBranchId] = useState(sp.get('branch') || 'cs1')
  const [sport, setSport] = useState<SportKey>((sp.get('sport') as SportKey) || 'pickleball')
  const [date, setDate] = useState(sp.get('date') || TODAY)
  const [sel, setSel] = useState<{ courtId: string; idxs: number[] } | null>(null)
  const [code, setCode] = useState(sp.get('promo') || '')
  const [applied, setApplied] = useState<string | null>(sp.get('promo'))
  const [payMode, setPayMode] = useState<'deposit' | 'full'>('full') // D6: mặc định Thanh toán đủ 100%
  const frame = FRAMES.find((x) => x.label === sp.get('frame'))

  const branch = branches.find((b) => b.id === branchId)!
  const branchCourts = courts.filter((c) => c.branchId === branchId && c.active)
  const sportsHere = SPORTS.filter((s) => branchCourts.some((c) => c.sport === s.key))
  useEffect(() => { if (!sportsHere.some((s) => s.key === sport) && sportsHere[0]) setSport(sportsHere[0].key) }, [branchId]) // eslint-disable-line
  const rows = branchCourts.filter((c) => c.sport === sport)
  const holiday = holidayOn(holidays, date, branchId)
  const slots = slotsFor(branch, holidays, date)
  const past = date < TODAY
  const spInfo = SPORTS.find((s) => s.key === sport)!

  const isFree = (c: Court, i: number) => !blocker(c.id, date, slots[i].start, slots[i].end) && !lockAt(c.id, date, slots[i].start, slots[i].end)
  const toggle = (courtId: string, i: number) => setSel((cur) => toggleSelection(cur, courtId, i))

  const selCourt = sel ? courts.find((c) => c.id === sel.courtId) : undefined
  const selSlots = sel ? sel.idxs.map((i) => slots[i]).filter(Boolean) : []
  const stillValid = !!(sel && selCourt && selSlots.length === sel.idxs.length && rows.some((c) => c.id === sel.courtId) && sel.idxs.every((i) => isFree(selCourt, i)))
  const active = stillValid && selCourt ? { court: selCourt, slots: selSlots } : null

  const base = active ? slotsPrice(active.court, active.slots) : 0
  const hours = active ? slotsHours(active.slots) : 0
  const promoRes = active && applied ? evalPromo(promos.find((p) => p.code === applied), active.court, date, active.slots, base, { phone: user?.phone }) : null
  const off = promoRes?.ok ? promoRes.off : 0
  const total = base - off
  const deposit = active ? depositFor(active.court, total) : 0
  const fullOnly = active ? depositIsFull(active.court, total) : false // UC 007 Alt 1a: cọc 100% => chỉ thanh toán đủ
  const mode = fullOnly ? 'full' : payMode
  const dueNow = mode === 'full' ? total : deposit
  const anyFree = rows.some((c) => slots.some((_, i) => isFree(c, i)))

  const apply = (c = code) => {
    const v = c.trim().toUpperCase()
    if (!v) return toast('Vui lòng nhập mã giảm giá.', 'err')
    setCode(v); setApplied(v)
  }
  const clearPromo = () => { setApplied(null); setCode('') }

  const submit = () => {
    if (!active) return
    if (!user) {
      toast('Vui lòng đăng nhập để tiếp tục đặt sân.', 'info')
      return nav('/login', { state: { from: loc.pathname + loc.search } })
    }
    const nb = createBooking({
      id: peekOrderId(date), customer: user.name, phone: user.phone, member: true, courtId: active.court.id, date,
      start: active.slots[0].start, end: active.slots[active.slots.length - 1].end, subtotal: base, discount: off, total,
      depositAmount: deposit, unitPriceSnap: Math.round(base / hours), payMode: mode, method: 'qr', source: 'online',
      promo: promoRes?.ok ? applied! : undefined,
    }, 'pending')
    toast(`Đã giữ chỗ đơn #${nb.id} trong ${HOLD_MINUTES} phút.`, 'ok')
    nav(`/payment/${nb.id}`)
  }

  const hint = (() => {
    if (!rows.length) return '—'
    const same = rows.every((c) => JSON.stringify(c.priceRules) === JSON.stringify(rows[0].priceRules))
    if (!same) return 'Giá khác nhau theo từng sân (xem đơn giá dưới mỗi ô giờ)'
    return rows[0].priceRules.map((r) => `${r.label} ${r.start.slice(0, 2)}h–${r.end.slice(0, 2)}h: ${kfmt(r.price)}/h`).join(' • ')
  })()
  const colSpanAll = slots.length + 1
  // Bố cục một hàng sân: gộp các ô liên tiếp bị khóa thành một ô (colSpan)
  const layout = (c: Court) => {
    const out: { i: number; span: number; lk?: Lock }[] = []
    for (let i = 0; i < slots.length; i++) {
      const lk = lockAt(c.id, date, slots[i].start, slots[i].end)
      let span = 1
      if (lk) while (i + span < slots.length && lockAt(c.id, date, slots[i + span].start, slots[i + span].end)) span++
      out.push({ i, span, lk })
      i += span - 1
    }
    return out
  }

  return (
    <>
      <section className="card card-lg col g16" style={{ borderRadius: 16 }}>
        <div className="row between wrap g16">
          <div className="col g2">
            <h1 className="t20 w800 c-ink">Chọn khung giờ đặt sân trực tuyến</h1>
            <p className="t12 c-s600">Nhấp vào ô màu trắng (Còn trống) trên bảng lịch để chọn khung giờ. Có thể chọn nhiều khung liền kề cùng một sân.</p>
          </div>
          <div className="row g12 wrap">
            <span className="legend"><i />Còn trống</span><span className="legend"><i className="sel" />Đang chọn</span>
            <span className="legend"><i className="busy" />Đã có người đặt</span><span className="legend"><i className="lock" />Bảo trì / Đóng cửa</span>
          </div>
        </div>
        <div className="row g16" style={{ alignItems: 'flex-end' }}>
          <div className="f1"><label className="label">Chi nhánh</label>
            <select className="select" value={branchId} onChange={(e) => { setBranchId(e.target.value); setSel(null) }}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div className="f1"><label className="label">Bộ môn</label>
            <select className="select" value={sport} onChange={(e) => { setSport(e.target.value as SportKey); setSel(null) }}>
              {sportsHere.map((s) => <option key={s.key} value={s.key}>{s.label} ({branchCourts.filter((c) => c.sport === s.key).length} sân{s.key === 'pickleball' ? ' mái che' : ''})</option>)}
            </select></div>
          <div className="f1"><label className="label">Ngày đặt lịch</label>
            <input className="input" type="date" value={date} min={TODAY} onChange={(e) => { setDate(e.target.value || TODAY); setSel(null) }} /></div>
          <div className="f1 hint hint-green col g2" style={{ borderColor: 'var(--brand-100)', background: 'var(--brand-50)' }}>
            <span className="w700 c-brand9">Đơn giá thuê sân {spInfo.label}:</span>
            <b className="c-brand8">{hint}</b>
          </div>
        </div>
      </section>

      <div className="grid12">
        <section className="span8 card card-lg col g16">
          <div className="row between">
            <h2 className="t16 w800 c-ink">Lịch sân {dow(date)}, {toVN(date)} – {branch.name.replace(' - ', ' ')}</h2>
            <span className="badge b-green-flat" style={{ fontSize: 11 }}>Giờ mở cửa: {branch.hours[new Date(date + 'T00:00:00').getDay()].closed ? 'Đóng cửa' : `${branch.hours[new Date(date + 'T00:00:00').getDay()].open} – ${branch.hours[new Date(date + 'T00:00:00').getDay()].close}`}</span>
          </div>
          {holiday && <div className="hint" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber-300)', color: 'var(--amber-900)' }}>📅 {toVN(date)} là ngày nghỉ: {holiday.note}. Hệ thống không nhận lịch trong ngày này.</div>}
          {past && <div className="hint">Không thể đặt lịch cho ngày đã qua.</div>}
          {!holiday && !past && rows.length > 0 && slots.length > 0 && !anyFree && (
            <div className="hint" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber-300)', color: 'var(--amber-900)' }}>Không còn khung giờ trống, vui lòng chọn ngày hoặc sân khác.</div>
          )}
          <table className="sched">
            <thead>
              <tr>
                <th>Sân thi đấu</th>
                {slots.map((s) => {
                  const rates = rows.map((c) => rateAt(c, hh(s.start)))
                  const lo = Math.min(...rates), hi = Math.max(...rates)
                  const inFrame = frame && hh(s.start) >= frame.from && hh(s.start) < frame.to
                  return (
                    <th key={s.start} style={inFrame ? { background: 'var(--brand-100)' } : undefined}>{s.start} - {s.end}
                      <small className={rows[0] && hh(s.start) >= 16 ? 'peak' : ''}>{rows.length ? (lo === hi ? `${kfmt(lo)}/h` : `${kfmt(lo)}–${kfmt(hi)}/h`) : ''}</small>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={colSpanAll} className="closed" style={{ padding: 24 }}>Chi nhánh chưa có sân cho bộ môn này.</td></tr>}
              {rows.length > 0 && slots.length === 0 && <tr><td colSpan={colSpanAll} className="closed" style={{ padding: 24 }}>Chi nhánh đóng cửa trong ngày này.</td></tr>}
              {slots.length > 0 && rows.map((c) => {
                const lockedAny = slots.some((s) => lockAt(c.id, date, s.start, s.end))
                const cells = layout(c).map(({ i, span, lk }) => {
                  const s = slots[i]
                  if (lk) return <td key={i} colSpan={span} className="locked">🔒 {lk.mode === 'stop' ? 'Ngừng khai thác sân' : `Tạm ngưng nhận lịch để ${lk.reason.toLowerCase()}`}</td>
                  const bk = blocker(c.id, date, s.start, s.end)
                  const price = money(slotPrice(c, s))
                  if (bk) return <td key={i}><div className="cell busy">Đã đặt<small>{bk.status === 'pending' ? 'Đang giữ chỗ' : bk.phone === user?.phone ? 'Lịch của bạn' : bk.label ?? 'Kín lịch'}</small></div></td>
                  if (active && sel?.courtId === c.id && sel.idxs.includes(i)) return <td key={i}><button className="cell sel" onClick={() => toggle(c.id, i)}>Đang chọn<small>{price}</small></button></td>
                  return <td key={i}><button className="cell free" disabled={past} onClick={() => toggle(c.id, i)}>Còn trống<small>{price}</small></button></td>
                })
                return (
                  <tr key={c.id}>
                    <td><div className="t12 w800 c-ink">{c.name}</div>
                      <div className="t11 w600" style={{ color: lockedAny ? 'var(--amber-800)' : 'var(--brand-700)' }}>● {lockedAny ? 'Bảo trì' : 'Sẵn sàng'}</div></td>
                    {cells}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="hint row g4 wrap" style={{ borderRadius: 12 }}>
            💡 Sau khi nhấn <b>"Tiếp tục thanh toán"</b>, hệ thống sẽ giữ chỗ tạm thời khung giờ này trong <b>{HOLD_MINUTES} phút</b> để bạn hoàn tất chuyển khoản <b>QR</b>.
          </div>
        </section>

        <aside className="span4 card card-lg card-raise col g16" style={{ position: 'sticky', top: 80 }}>
          <div className="col g2 head-rule">
            <span className="eyebrow">Phiếu đặt sân</span>
            <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Thông tin lịch đã chọn</h2>
          </div>
          {!active ? (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Chưa chọn khung giờ. Nhấp vào một ô <b>Còn trống</b> trên bảng lịch để bắt đầu.</div>
          ) : (
            <>
              <div className="col g10 t12">
                <div className="row between"><span className="c-s600">Chi nhánh:</span><b className="c-ink">{branch.name}</b></div>
                <div className="row between"><span className="c-s600">Sân thi đấu:</span><b className="c-brand w800">{active.court.name}</b></div>
                <div className="row between g12"><span className="c-s600 nowrap">Thời gian thuê:</span><b className="c-ink" style={{ textAlign: 'right' }}>{toVN(date)} • {active.slots[0].start} - {active.slots[active.slots.length - 1].end} ({hours} giờ)</b></div>
              </div>
              <div className="col g8 top-rule" style={{ paddingTop: 16 }}>
                <label className="label" style={{ margin: 0 }}>Mã giảm giá / Ưu đãi hội viên</label>
                <div className="row g8">
                  <input className="input sm bold" style={{ padding: '10px 14px', fontSize: 14 }} value={code} placeholder="Nhập mã ưu đãi" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} />
                  <button className="btn btn-dark btn-md" onClick={() => apply()}>Áp dụng</button>
                </div>
                <div className="row g6 wrap">
                  {promos.filter((p) => !p.counterOnly && promoActive(p) && (p.targetAudience === 'all' || (!!user && p.targetPhones.includes(user.phone)))).slice(0, 2).map((p) => (
                    <button key={p.code} className={`badge ${applied === p.code ? 'b-green' : 'b-gray-o'}`} style={{ fontSize: 11 }} onClick={() => apply(p.code)}>{p.code} (-{promoSummary(p)})</button>
                  ))}
                  <button className="badge b-gray-o" style={{ fontWeight: 500, fontSize: 11 }} onClick={clearPromo}>Bỏ chọn</button>
                </div>
                {promoRes && <p className={promoRes.ok ? 'field-ok' : 'field-err'}>{promoRes.msg}</p>}
              </div>
              <div className="col g8 top-rule" style={{ paddingTop: 16 }}>
                <label className="label" style={{ margin: 0 }}>Phương thức giữ sân</label>
                {([['full', 'Thanh toán đủ 100%', total, 'Tất toán toàn bộ đơn đặt sân, đến giờ vào sân chơi ngay.'], ['deposit', `Đặt cọc giữ sân (${depositLabel(active.court)})`, deposit, fullOnly ? 'Sân này yêu cầu cọc 100% tiền thuê — vui lòng chọn Thanh toán đủ.' : 'Thanh toán trước để giữ lịch. Phần còn lại thanh toán tại quầy khi đến nhận sân.']] as const).map(([k, t, amt, d]) => (
                  <label key={k} className={`radio-card${mode === k ? ' on' : ''}`} style={{ alignItems: 'flex-start', padding: mode === k ? 11 : 12, borderRadius: 12, opacity: k === 'deposit' && fullOnly ? 0.55 : 1 }}>
                    <input type="radio" name="paymode" checked={mode === k} disabled={k === 'deposit' && fullOnly} onChange={() => setPayMode(k)} style={{ marginTop: 3 }} />
                    <div className="col g2 f1"><div className="row between"><span className="t12 w800 c-ink">{t}</span><span className="t12 w800 c-ink">{vnd(amt)}</span></div>
                      <span className="t11 c-s600" style={{ fontWeight: 400, lineHeight: '15px' }}>{d}</span></div>
                  </label>
                ))}
                {mode === 'deposit' && (
                  <div className="hint" style={{ background: 'var(--rose-50)', borderColor: 'var(--rose-300)', color: 'var(--rose-950)', padding: 10 }}>
                    ⚠️ Tiền cọc không được hoàn lại nếu hủy đơn hoặc không đến nhận sân đúng giờ.
                  </div>
                )}
              </div>
              <div className="hint col g8" style={{ padding: 14 }}>
                <div className="row between"><span className="c-s600">Giá thuê sân gốc:</span><b>{vnd(base)}</b></div>
                <div className="row between"><span className="c-s600">Ưu đãi giảm giá:</span><b className="c-brand">{off ? `- ${vnd(off)}` : '0 VNĐ'}</b></div>
                <div className="row between top-rule" style={{ paddingTop: 8 }}><b className="c-ink">Tổng tiền sau giảm:</b><b className="c-ink">{vnd(total)}</b></div>
                <div className="row between"><b className="c-brand t14">Cần thanh toán ngay:</b><b className="c-brand t16">{vnd(dueNow)}</b></div>
                <div className="row between t11"><span className="c-s600">Thanh toán thêm khi nhận sân:</span><span className="c-s600">{vnd(total - dueNow)}</span></div>
              </div>
              <button className="btn btn-primary btn-lg btn-block" onClick={submit}>Tiếp tục thanh toán QR →</button>
            </>
          )}
        </aside>
      </div>
    </>
  )
}
