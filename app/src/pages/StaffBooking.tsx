import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { SPORTS, TODAY } from '../data'
import type { SportKey } from '../data'
import type { StaffOutlet } from '../layouts'
import { useApp, useNow } from '../appContext'
import VietQrBox from '../components/VietQrBox'
import { depositFor, depositIsFull, depositLabel, evalPromo, promoActive, ruleLabelAt, slotPrice, slotsHours, slotsPrice } from '../domain/pricing'
import { holidayOn, slotsFor, toggleSelection } from '../domain/slots'
import type { Selection } from '../domain/slots'
import { hh, kfmt, money, nowMs, vnd } from '../utils/format'

export default function StaffBooking() {
  const { user, courts, branches, promos, customers, transactions, blocker, lockAt, holidays, createBooking, peekOrderId, receipt, setReceipt, toast } = useApp()
  const { branchFilter } = useOutletContext<{ branchFilter: string } & StaffOutlet>()
  const branchId = branchFilter === 'all' ? branches[0].id : branchFilter
  const branch = branches.find((b) => b.id === branchId)!
  const now = useNow(1000)
  const [date, setDate] = useState(TODAY)
  const [sport, setSport] = useState<'all' | SportKey>('all')
  const [sel, setSel] = useState<Selection | null>(null)
  const [kind, setKind] = useState<'walkin' | 'member'>('walkin')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [lookupMsg, setLookupMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isMember, setIsMember] = useState(false)
  const [promoChoice, setPromoChoice] = useState<string | null>(null) // null = tự chọn mã quầy của chi nhánh (nếu có)
  const [level, setLevel] = useState<'full' | 'deposit'>('full')
  const [method, setMethod] = useState<'cash' | 'qr'>('cash')
  const [qrAt, setQrAt] = useState<number | null>(null)
  const [checks, setChecks] = useState(0)

  const bCourts = courts.filter((c) => c.branchId === branchId && c.active)
  const rows = sport === 'all' ? bCourts : bCourts.filter((c) => c.sport === sport)
  const holiday = holidayOn(holidays, date, branchId)
  const slots = slotsFor(branch, holidays, date)
  const court = sel ? courts.find((c) => c.id === sel.courtId && c.branchId === branchId) : undefined
  const selSlots = sel ? sel.idxs.map((i) => slots[i]).filter(Boolean) : []
  const free = !!(court && sel && selSlots.length === sel.idxs.length && selSlots.every((s) => !blocker(court.id, date, s.start, s.end) && !lockAt(court.id, date, s.start, s.end)))
  const active = free && court ? { court, slots: selSlots } : null

  const defaultPromo = promos.find((p) => p.counterOnly && promoActive(p) && p.branchId === branchId)?.code ?? ''
  const promoCode = promoChoice ?? defaultPromo
  const base = active ? slotsPrice(active.court, active.slots) : 0
  const promoRes = active && promoCode ? evalPromo(promos.find((p) => p.code === promoCode), active.court, date, active.slots, base, { counter: true, phone: phone.trim() }) : null
  const off = promoRes?.ok ? promoRes.off : 0
  const total = base - off
  const deposit = active ? depositFor(active.court, total) : 0
  const fullOnly = active ? depositIsFull(active.court, total) : false
  const lvl = fullOnly ? 'full' : level
  const pay = lvl === 'full' ? total : deposit
  const orderId = peekOrderId(date)
  const qrLeft = qrAt ? Math.max(0, 600 - Math.floor((now - qrAt) / 1000)) : 600

  const validPhone = (p: string) => /^0\d{9}$/.test(p.trim())
  const lookup = () => {
    if (!validPhone(phone)) { setIsMember(false); return setLookupMsg({ ok: false, text: 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).' }) }
    const m = customers.find((x) => x.phone === phone.trim() || x.aliases?.includes(phone.trim()))
    if (m) { setName(m.name); setIsMember(true); setKind('member'); setLookupMsg({ ok: true, text: `✓ Tìm thấy hội viên: ${m.name}.` }) }
    else { setIsMember(false); setLookupMsg({ ok: false, text: 'Không tìm thấy hội viên — ghi nhận là khách vãng lai.' }) }
  }
  const reset = () => { setSel(null); setPhone(''); setName(''); setLookupMsg(null); setIsMember(false); setKind('walkin'); setLevel('full'); setMethod('cash'); setQrAt(null); setChecks(0); setPromoChoice(null) }
  const chooseMethod = (m: 'cash' | 'qr') => { setMethod(m); setChecks(0); setQrAt(m === 'qr' ? nowMs() : null) }
  const regenQr = () => { setQrAt(nowMs()); setChecks(0); toast('Đã tạo lại mã QR mới (hiệu lực 10 phút).', 'ok') }
  const checkTx = () => {
    setChecks((c) => c + 1)
    if (checks === 0) toast('Chưa nhận được giao dịch báo có. Vui lòng kiểm tra lại sau ít giây.', 'info')
    else toast(`Đã nhận giao dịch ${vnd(pay)} đúng số tiền & nội dung.`, 'ok')
  }

  const submit = () => {
    if (!active) return toast('Vui lòng chọn một ô trống trên bảng lịch.', 'err')
    if (!validPhone(phone)) return toast('Số điện thoại khách không hợp lệ (10 chữ số).', 'err')
    if (!name.trim()) return toast('Vui lòng nhập họ và tên khách.', 'err')
    if (kind === 'member' && !isMember) return toast('Chưa xác định được hội viên — hãy bấm Tra cứu hoặc chuyển sang Khách vãng lai.', 'err')
    const hours = slotsHours(active.slots)
    const nb = createBooking({
      id: orderId, customer: name.trim(), phone: phone.trim(), member: isMember, courtId: active.court.id, date,
      start: active.slots[0].start, end: active.slots[active.slots.length - 1].end, subtotal: base, discount: off, total,
      depositAmount: deposit, unitPriceSnap: Math.round(base / hours), payMode: lvl, method, source: 'counter',
      promo: promoRes?.ok ? promoCode : undefined,
    }, 'confirmed', { amount: pay, method, staffId: user?.staffId })
    setReceipt({ code: `PT${nb.id.slice(2, 8)}${transactions.length % 90 + 10}`, order: `#${nb.id}`, amount: pay, method: method === 'cash' ? 'Tiền mặt' : 'VietQR', cashier: user?.name ?? '' })
    toast(`Đã thu ${vnd(pay)} & tạo đơn #${nb.id}.`, 'ok')
    reset()
  }

  const cellFor = (c: (typeof rows)[number], i: number) => {
    const s = slots[i]
    if (lockAt(c.id, date, s.start, s.end)) return <td key={i} className="locked">🔒 Bảo trì</td>
    const bk = blocker(c.id, date, s.start, s.end)
    if (bk) {
      if (bk.status === 'playing') return <td key={i}><div className="cell play">Đang chơi<small>{bk.member ? `#${bk.id}` : 'Khách lẻ'}</small></div></td>
      const t = bk.status === 'pending' ? 'Chờ chuyển khoản' : bk.paid >= bk.total ? 'Đã thu 100%' : `Đã cọc ${kfmt(bk.paid)}`
      return <td key={i}><div className="cell hold">{t}<small>{bk.status === 'overdue' ? 'Quá giờ nhận sân' : `#${bk.id}`}</small></div></td>
    }
    if (active && sel?.courtId === c.id && sel.idxs.includes(i)) return <td key={i}><button className="cell sel" onClick={() => setSel((x) => toggleSelection(x, c.id, i))}>Đang chọn<small>{money(slotPrice(c, s))}</small></button></td>
    return <td key={i}><button className="cell free" onClick={() => setSel((x) => toggleSelection(x, c.id, i))}>Còn trống<small>{money(slotPrice(c, s))}</small></button></td>
  }

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g16 wrap">
          <div className="row g8"><span className="t12 w600 c-s600">Ngày đặt sân:</span>
            <input type="date" className="input sm" style={{ width: 'auto' }} value={date} min={TODAY} onChange={(e) => { setDate(e.target.value || TODAY); setSel(null) }} /></div>
          <div className="row g8"><span className="t12 w600 c-s600">Bộ môn:</span>
            <select className="select sm fit" style={{ background: 'var(--s100)' }} value={sport} onChange={(e) => setSport(e.target.value as 'all' | SportKey)}>
              <option value="all">Tất cả sân trong cơ sở ({bCourts.length} sân)</option>
              {SPORTS.filter((s) => bCourts.some((c) => c.sport === s.key)).map((s) => <option key={s.key} value={s.key}>{s.label} ({bCourts.filter((c) => c.sport === s.key).length} sân)</option>)}
            </select></div>
        </div>
        <div className="row g16 wrap">
          <span className="legend"><i />Còn trống</span><span className="legend"><i className="sel" />Đang chọn</span>
          <span className="legend"><i className="play" />Khách đang chơi</span><span className="legend"><i className="hold" />Đã đặt trước</span>
        </div>
      </section>

      <div className="grid12">
        <div className="span7 col g16">
          <section className="card card-lg col g16" style={{ padding: 20 }}>
            <div className="row between">
              <h2 className="t14 w800 c-ink">Bảng lịch sân trực tiếp – Nhấp chọn ô trống để lập đơn</h2>
              <span className="badge b-green-flat" style={{ fontSize: 11 }}>Ca trực: {user?.name}</span>
            </div>
            {holiday && <div className="hint" style={{ background: 'var(--amber-50)', borderColor: 'var(--amber-300)', color: 'var(--amber-900)' }}>📅 {holiday.note}</div>}
            <table className="sched">
              <thead><tr><th>Tên sân</th>{slots.map((s) => <th key={s.start}>{s.start} - {s.end}<small className={rows[0] && hh(s.start) >= 16 ? 'peak' : ''}>{rows[0] ? ruleLabelAt(rows[0], hh(s.start)) : ''}</small></th>)}</tr></thead>
              <tbody>
                {slots.length === 0 && <tr><td colSpan={2} className="closed" style={{ padding: 24 }}>Chi nhánh đóng cửa / nghỉ lễ trong ngày này.</td></tr>}
                {slots.length > 0 && rows.map((c) => (
                  <tr key={c.id}>
                    <td><div className="t12 w800 c-ink">{c.name}</div><div className="t11 c-s600">{kfmt(Math.min(...c.priceRules.map((r) => r.price)))} - {kfmt(Math.max(...c.priceRules.map((r) => r.price)))}/h</div></td>
                    {slots.map((_, i) => cellFor(c, i))}
                  </tr>
                ))}
              </tbody>
            </table>
            {receipt && (
              <div className="col g6" style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-300)', borderRadius: 12, padding: 14 }}>
                <div className="row between"><b className="t12 c-brand9">🧾 Phiếu thu gần nhất tại quầy</b><span className="badge c-white" style={{ background: 'var(--brand-700)', borderRadius: 4, fontSize: 11 }}>Đã thu tiền & Giữ lịch</span></div>
                <div className="row g24 wrap t12"><span>Mã phiếu: <b>{receipt.code}</b></span><span>Mã đơn: <b>{receipt.order}</b></span><span>Thực thu: <b>{vnd(receipt.amount)} ({receipt.method})</b></span><span>Thu ngân: <b>{receipt.cashier}</b></span></div>
              </div>
            )}
          </section>
        </div>

        <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
          <div className="row between head-rule">
            <div className="col g2"><span className="eyebrow">Phiếu đặt sân tại quầy</span><h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Thông tin khách & Thu tiền</h2></div>
            {active ? <span className="badge b-green-flat" style={{ fontSize: 11 }}>{active.court.name} ({active.slots[0].start} - {active.slots[active.slots.length - 1].end})</span>
              : <span className="badge b-gray-o" style={{ fontSize: 11 }}>Chưa chọn sân</span>}
          </div>

          <div className="col g8">
            <label className="label" style={{ margin: 0 }}>Loại khách hàng</label>
            <div className="row g8">
              {([['walkin', 'Khách vãng lai'], ['member', 'Hội viên có tài khoản']] as const).map(([k, l]) => (
                <button key={k} type="button" className={`radio-card f1 center${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); if (k === 'walkin') setIsMember(false) }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="row g12" style={{ alignItems: 'flex-start' }}>
            <div style={{ width: '48%' }}>
              <label className="label">Số điện thoại khách <span className="req">*</span></label>
              <div className="row g8"><input className="input sm" placeholder="09xxxxxxxx" value={phone} onChange={(e) => { setPhone(e.target.value); setLookupMsg(null); setIsMember(false) }} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
                <button type="button" className="btn btn-dark btn-sm" onClick={lookup}>Tra cứu</button></div>
            </div>
            <div className="f1"><label className="label">Họ và tên khách <span className="req">*</span></label>
              <input className="input sm" placeholder="Nhập họ tên" value={name} onChange={(e) => setName(e.target.value)} /></div>
          </div>
          <p className={lookupMsg ? (lookupMsg.ok ? 'field-ok' : 't12 c-s600') : 't12 c-s600'} style={{ marginTop: -6 }}>
            {lookupMsg?.text ?? <>Khách đặt trực tiếp tại quầy chưa có tài khoản sẽ được ghi nhận là <b>Khách vãng lai</b>.</>}
          </p>

          <div className="top-rule col g8" style={{ paddingTop: 16 }}>
            <label className="label" style={{ margin: 0 }}>Chương trình khuyến mãi / Mã giảm giá</label>
            <select className="select sm" value={promoCode} onChange={(e) => setPromoChoice(e.target.value)}>
              <option value="">Không áp dụng</option>
              {promos.filter((p) => promoActive(p) && (!p.branchId || p.branchId === branchId)).map((p) => {
                const r = active ? evalPromo(p, active.court, date, active.slots, base, { counter: true, phone: phone.trim() }) : null
                return <option key={p.code} value={p.code}>{p.code} – {p.name}{r?.ok ? ` (-${money(r.off)})` : ''}</option>
              })}
            </select>
            {promoRes && !promoRes.ok && <p className="field-err">{promoRes.msg}</p>}
          </div>

          <div className="top-rule col g8" style={{ paddingTop: 16 }}>
            <label className="label" style={{ margin: 0 }}>Mức thanh toán</label>
            <div className="row g8">
              {([['full', 'Thu đủ 100%'], ['deposit', `Thu cọc giữ sân (${active ? depositLabel(active.court) : '30%'})`]] as const).map(([k, l]) => (
                <label key={k} className={`radio-card f1${lvl === k ? ' on' : ''}`} style={{ opacity: k === 'deposit' && fullOnly ? 0.55 : 1 }}><input type="radio" name="level" checked={lvl === k} disabled={k === 'deposit' && fullOnly} onChange={() => setLevel(k)} />{l}</label>
              ))}
            </div>
            {lvl === 'deposit' && <p className="t11" style={{ color: 'var(--rose-800)' }}>⚠️ Tiền cọc không được hoàn lại nếu khách hủy đơn hoặc không đến nhận sân đúng giờ.</p>}
          </div>
          <div className="top-rule col g8" style={{ paddingTop: 16 }}>
            <label className="label" style={{ margin: 0 }}>Hình thức thu tiền tại quầy</label>
            <div className="row g8">
              {([['cash', '💵 Tiền mặt'], ['qr', '📱 Quét mã VietQR']] as const).map(([k, l]) => (
                <label key={k} className={`radio-card f1${method === k ? ' on' : ''}`}><input type="radio" name="method" checked={method === k} onChange={() => chooseMethod(k)} />{l}</label>
              ))}
            </div>
            {method === 'qr' && active && (
              <div className="col g8">
                <VietQrBox variant="compact" alt="VietQR" branch={branch} amount={pay} content={`THANHTOAN ${orderId}`} />
                <div className="row between wrap g8 t11">
                  <span className="c-s600">Mã QR còn hiệu lực: <b className="mono">{String(Math.floor(qrLeft / 60)).padStart(2, '0')}:{String(qrLeft % 60).padStart(2, '0')}</b></span>
                  <span className={checks >= 2 ? 'c-brand8 w700' : 'c-s600'}>{checks >= 2 ? '✓ Đã nhận giao dịch' : 'Chưa xác nhận giao dịch'}</span>
                </div>
                <div className="row g8 wrap">
                  <button type="button" className="btn btn-outline btn-xs" onClick={checkTx}>Kiểm tra lại giao dịch</button>
                  <button type="button" className="btn btn-outline btn-xs" onClick={regenQr}>Tạo lại mã QR</button>
                  <button type="button" className="btn btn-outline btn-xs" onClick={() => chooseMethod('cash')}>Chuyển thu tiền mặt</button>
                </div>
              </div>
            )}
          </div>

          <div className="hint col g8" style={{ padding: 16 }}>
            <div className="row between"><span className="c-s600">Tiền sân theo khung giờ:</span><b>{vnd(base)}</b></div>
            <div className="row between"><span className="c-brand w600">Giảm giá khuyến mãi:</span><b className="c-brand">{off ? `- ${vnd(off)}` : '0 VNĐ'}</b></div>
            <div className="row between top-rule" style={{ paddingTop: 8 }}><b className="t14 c-brand9">Cần thu khách ngay:</b><b className="t16 c-brand8 w800">{vnd(pay)}</b></div>
            <div className="row between t11"><span className="c-s600">Còn lại thu khi nhận sân:</span><span className="c-s700">{vnd(total - pay)}</span></div>
            {active && <span className="t11 c-s500">Thời lượng: {slotsHours(active.slots)} giờ • {branch.name}</span>}
          </div>
          <div className="row g8">
            <button className="btn btn-primary btn-lg f1" onClick={submit}>✓ Xác nhận thu tiền & Tạo đơn</button>
            <button className="btn btn-outline btn-lg" onClick={reset}>Hủy tạo đơn</button>
          </div>
        </aside>
      </div>
    </>
  )
}
