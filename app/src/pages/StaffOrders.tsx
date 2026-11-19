import { useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { STATUS_LABEL, TODAY, branchOf, remaining } from '../data'
import type { Booking, CancelCategory } from '../data'
import type { StaffOutlet } from '../layouts'
import { useApp } from '../appContext'
import AffectedBookingsModal from '../components/AffectedBookingsModal'
import VietQrBox from '../components/VietQrBox'
import { calculateRefund, isNoShowEligible } from '../domain/refund'
import { kfmt, money, toVN, vnd } from '../utils/format'

type F = 'all' | 'waiting' | 'playing' | 'overdue' | 'pending' | 'completed' | 'cancelled' | 'expired' | 'affected'
const REASONS = ['Khách yêu cầu hủy lịch', 'Khách quá giờ nhận sân không đến', 'Sân gặp sự cố / bảo trì đột xuất', 'Đặt nhầm khung giờ', 'Lý do khác']
const SORT = ['overdue', 'confirmed', 'pending', 'playing', 'completed', 'cancelled', 'expired']

export default function StaffOrders() {
  const { user, bookings, courts, checkIn, settleBooking, completeBooking, cancelBooking, toast } = useApp()
  const { branchFilter } = useOutletContext<StaffOutlet>()
  const branchId = branchFilter
  const [sp] = useSearchParams()
  const bid = sp.get('bookingId')
  const [date, setDate] = useState(TODAY)
  const [f, setF] = useState<F>('all')
  const [q, setQ] = useState(bid ?? '')
  const [query, setQuery] = useState(bid ?? '')
  const inBranch = (b: Booking) => courts.find((c) => c.id === b.courtId)?.branchId === branchId
  const todays = bookings.filter((b) => b.date === date && inBranch(b))
  const affected = bookings.filter((b) => b.isAffected && ['pending', 'confirmed', 'overdue'].includes(b.status) && inBranch(b))
  const [settleId, setSettleId] = useState<string | null>(() => todays.find((b) => b.id === bid && b.status === 'confirmed' && remaining(b) > 0)?.id ?? todays.find((b) => b.status === 'confirmed' && remaining(b) > 0)?.id ?? null)
  const [cancelId, setCancelId] = useState<string | null>(() => todays.find((b) => b.id === bid && b.status === 'overdue')?.id ?? todays.find((b) => b.status === 'overdue')?.id ?? null)
  const [category, setCategory] = useState<CancelCategory>(() => (todays.some((b) => b.status === 'overdue') ? 'noshow' : 'customer'))
  const [method, setMethod] = useState<'qr' | 'cash'>('qr')
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [cErr, setCErr] = useState('')

  const is = (b: Booking, k: F) => (k === 'waiting' ? b.status === 'confirmed' : b.status === k)
  const cnt = (k: F) => (k === 'all' ? todays.length : k === 'affected' ? affected.length : todays.filter((b) => is(b, k)).length)
  const kw = query.trim().replace('#', '').toLowerCase()
  const rows = todays.filter((b) => (f === 'all' || is(b, f)) && (!kw || b.id.toLowerCase().includes(kw) || b.customer.toLowerCase().includes(kw) || b.phone.includes(kw)))
    .sort((a, b) => SORT.indexOf(a.status) - SORT.indexOf(b.status) || a.start.localeCompare(b.start))
  const cName = (b: Booking) => courts.find((c) => c.id === b.courtId)?.name ?? ''
  const settle = bookings.find((b) => b.id === settleId && b.status === 'confirmed')
  const cancel = bookings.find((b) => b.id === cancelId && ['confirmed', 'overdue', 'pending'].includes(b.status))
  const preview = cancel ? calculateRefund({ playDate: cancel.date, playStart: cancel.start, paid: cancel.paid, depositAmount: cancel.depositAmount, category }) : null

  const dayLabel = date === TODAY ? 'hôm nay' : `ngày ${toVN(date)}`
  const tabs: [F, string][] = [['all', `Tất cả đơn ${dayLabel}`], ['waiting', 'Chờ khách nhận sân'], ['playing', 'Đang chơi trên sân'], ['overdue', 'Quá giờ nhận sân'], ['pending', 'Chờ thanh toán'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã hủy'], ['expired', 'Quá hạn thanh toán'], ['affected', 'Đơn bị ảnh hưởng']]
  const statusBadge = (b: Booking) => {
    const m: Record<string, string> = { confirmed: 'b-sky', playing: 'b-mint', overdue: 'b-amber', pending: 'b-amber', completed: 'b-gray', cancelled: 'b-rose', expired: 'b-gray' }
    return <span className={`badge ${m[b.status]}`}>{STATUS_LABEL[b.status]}</span>
  }
  const openCancel = (b: Booking) => { setCancelId(b.id); setCategory(b.status === 'overdue' ? 'noshow' : 'customer'); setCErr('') }
  const doCheckIn = (b: Booking) => {
    const r = checkIn(b.id)
    if (!r.ok) return toast(r.error ?? 'Không thể nhận sân.', 'err')
    toast(`Đã bàn giao ${cName(b)} cho khách.`, 'ok')
  }
  const doSettle = () => {
    if (!settle) return
    const r = settleBooking(settle.id, method, user?.staffId)
    if (!r.ok) return toast(r.error ?? 'Không thể nhận sân.', 'err')
    toast(`Đã thu đủ ${vnd(remaining(settle))} & cho khách vào sân.`, 'ok'); setSettleId(null)
  }
  const doCancel = () => {
    if (!cancel) return
    if (category === 'noshow' && cancel.status !== 'overdue' && !isNoShowEligible(cancel.date, cancel.start)) return setCErr('Chưa quá giờ nhận sân quy định (30 phút) — không thể chọn "Khách không đến nhận sân".')
    cancelBooking(cancel.id, { reason: note.trim() ? `${reason} – ${note.trim()}` : reason, category, by: user?.role ?? 'staff' })
    toast(`Đã hủy đơn #${cancel.id} & mở trống sân.`); setCancelId(null); setNote(''); setCErr('')
  }

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          {tabs.map(([k, l]) => <button key={k} data-testid={k === 'affected' ? 'affected-orders-tab' : undefined} className={`btn btn-md ${f === k ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '8px 14px', background: f === k ? undefined : 'var(--s100)', fontWeight: f === k ? 700 : 600 }} onClick={() => setF(k)}>{l} ({cnt(k)})</button>)}
        </div>
        <div className="row g8">
          <input data-testid="orders-date-filter" type="date" className="input sm" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value || TODAY)} />
          <input className="input sm" style={{ width: 240, background: 'var(--s50)', padding: '8px 14px', borderRadius: 12 }} placeholder="Mã đơn, tên hoặc SĐT khách" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQuery(q)} />
          <button className="btn btn-dark" onClick={() => setQuery(q)}>Tìm đơn</button>
        </div>
      </section>

      <div className="grid12">
        <section className="span8 card col g16">
          {f === 'affected' ? (
            <>
              <div className="col g2"><h2 className="t14 w800 c-ink">Đơn đặt sân bị ảnh hưởng — {branchOf(branchId).name}</h2><span className="t12 c-s600">Do sân bảo trì / ngừng khai thác / ngày nghỉ / đổi giờ mở cửa. Chọn Chuyển sân / Đổi giờ hoặc Đóng đơn do cơ sở.</span></div>
              <AffectedBookingsModal list={affected} testId="affected-orders-list" emptyText="Hiện không có đơn nào bị ảnh hưởng tại chi nhánh này." />
            </>
          ) : (
            <>
              <div className="row between">
                <h2 className="t14 w800 c-ink">Danh sách lịch đặt sân ngày {toVN(date)}</h2>
                <span className="t12 w500 c-s600">Lưu ý: Thu đủ 100% tiền sân trước khi bấm Nhận sân</span>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Mã đơn / Khách hàng</th><th>Sân & Giờ chơi</th><th>Thanh toán</th><th>Trạng thái</th><th className="r">Xử lý</th></tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>Không có đơn nào phù hợp.</td></tr>}
                    {rows.map((b) => {
                      const rem = remaining(b)
                      const late = b.status === 'overdue'
                      const closed = b.status === 'cancelled' || b.status === 'expired'
                      return (
                        <tr key={b.id} className={settleId === b.id && b.status === 'confirmed' ? 'hl' : ''}>
                          <td><div className="code mono">#{b.id}</div><div className="w700 c-s800">{b.customer}</div><div className="t11 c-s600">{b.phone}{!b.member ? ' (Khách vãng lai)' : ''}</div></td>
                          <td><div className="w800 c-ink">{cName(b)}</div><div className={`w700 ${late ? 'c-rose' : 'c-brand8'}`} style={late ? undefined : b.status === 'confirmed' ? { color: 'var(--s700)', fontWeight: 600 } : undefined}>{b.start} - {b.end}{late ? ' (Trễ 30p)' : ''}</div>
                            {(b.checkedInAt || b.completedAt) && <div className="t11 c-s600">{b.checkedInAt && `Nhận sân: ${b.checkedInAt}`}{b.completedAt && ` • Trả sân: ${b.completedAt}`}</div>}</td>
                          <td>
                            <div>Tổng: <b>{money(b.total)}</b>{b.paid > 0 && rem > 0 ? ` (Đã cọc: ${kfmt(b.paid)})` : ''}</div>
                            {closed ? <div className="c-s600">{b.status === 'cancelled' ? `Đã hủy${b.paid > 0 ? ` • Hoàn ${b.refundRate ?? 0}%: ${vnd(b.refundAmount ?? 0)}` : ''}` : 'Quá hạn thanh toán'}</div> : rem > 0
                              ? <div className="w800" style={{ color: late ? 'var(--amber-800)' : 'var(--rose-700)' }}>{late ? `Đã cọc: ${vnd(b.paid)}` : `Còn thiếu: ${vnd(rem)}`}</div>
                              : <div className="w700 c-brand8">Còn thiếu: 0 VNĐ</div>}
                            {!closed && !late && <span className={`badge sq ${rem === 0 ? 'b-green' : 'b-amber'}`} style={{ fontSize: 10, padding: '2px 8px', marginTop: 4 }}>{rem === 0 ? 'Đã trả đủ 100%' : b.paid > 0 ? 'Đã đặt cọc' : 'Chưa thanh toán'}</span>}
                          </td>
                          <td>{statusBadge(b)}{b.isAffected && <div className="t11 c-amber w700" style={{ marginTop: 4 }}>⚠ Bị ảnh hưởng</div>}</td>
                          <td className="r">
                            <div className="col g6" style={{ alignItems: 'flex-end' }}>
                              {b.status === 'confirmed' && rem > 0 && <button className="btn btn-primary btn-sm" onClick={() => setSettleId(b.id)}>Thu nốt {kfmt(rem)} & Nhận sân</button>}
                              {b.status === 'confirmed' && rem === 0 && <button className="btn btn-primary btn-sm" onClick={() => doCheckIn(b)}>Nhận sân ngay</button>}
                              {b.status === 'confirmed' && <button className="btn btn-danger-o btn-xs" style={{ fontWeight: 600 }} onClick={() => openCancel(b)}>Hủy lịch</button>}
                              {b.status === 'playing' && <button className="btn btn-dark btn-sm" onClick={() => { completeBooking(b.id); toast(`Đơn #${b.id} đã hoàn thành.`, 'ok') }}>✓ Kết thúc & Hoàn thành</button>}
                              {late && <button className="btn btn-danger btn-sm" onClick={() => openCancel(b)}>Hủy đơn & Mở sân</button>}
                              {b.status === 'pending' && <><span className="t11 c-amber w700">Chờ khách chuyển khoản</span><button className="btn btn-danger-o btn-xs" onClick={() => openCancel(b)}>Hủy lịch</button></>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <aside className="span4 col g20">
          <div className="card col g16" style={{ border: '2px solid var(--brand-700)', boxShadow: 'var(--shadow-md)' }}>
            <div className="row between head-rule">
              <div className="col g2" style={{ paddingTop: 5 }}><span className="eyebrow">Khách đến nhận sân</span><h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Thu tất toán & Bàn giao sân</h3></div>
              {settle && <span className="badge sq b-gray mono" style={{ fontSize: 11.5, fontWeight: 800 }}>#{settle.id}</span>}
            </div>
            {!settle ? <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Chọn nút <b>"Thu nốt … & Nhận sân"</b> ở một đơn trong bảng để thu tiền còn thiếu.</div> : (
              <>
                <div className="hint col g6">
                  <Line k="Khách hàng:" v={`${settle.customer} (${settle.phone})`} />
                  <Line k="Sân & Khung giờ:" v={`${cName(settle)} (${settle.start} - ${settle.end})`} />
                  <Line k="Tổng tiền đơn:" v={vnd(settle.total)} />
                  <Line k="Đã đặt cọc trước:" v={vnd(settle.paid)} green />
                  <div className="row between top-rule" style={{ paddingTop: 6, borderColor: 'var(--s300)' }}><b className="t14 c-rose" style={{ fontWeight: 800 }}>Cần thu thêm tại quầy:</b><b className="t14 c-rose" style={{ fontWeight: 800 }}>{vnd(remaining(settle))}</b></div>
                </div>
                {remaining(settle) > 0 && (
                  <div className="col g8">
                    <label className="label" style={{ margin: 0 }}>Hình thức thu phần còn lại</label>
                    <div className="row g8">
                      {([['qr', '📱 Quét QR'], ['cash', '💵 Tiền mặt']] as const).map(([k, l]) => <label key={k} className={`radio-card f1${method === k ? ' on' : ''}`} style={{ fontWeight: 700 }}><input type="radio" name="m" checked={method === k} onChange={() => setMethod(k)} />{l}</label>)}
                    </div>
                    {method === 'qr' && <VietQrBox variant="compact" alt="VietQR" branch={branchOf(branchId)} amount={remaining(settle)} content={`THANHTOAN ${settle.id}`} imgTestId="settle-qr-image" amountTestId="settle-qr-amount" />}
                  </div>
                )}
                <button className="btn btn-primary btn-lg btn-block" onClick={doSettle}>{remaining(settle) > 0 ? `✓ Đã thu đủ ${money(remaining(settle))} & Cho khách vào sân` : '✓ Cho khách vào sân'}</button>
              </>
            )}
          </div>

          <div className="card col g16">
            <div className="row between head-rule">
              <div className="col g2" style={{ paddingTop: 5 }}><span className="eyebrow" style={{ color: 'var(--rose-700)' }}>Xử lý hủy lịch</span><h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Hủy đơn & Giải phóng sân</h3></div>
              {cancel && <span className="badge sq b-rose-soft mono" style={{ background: 'var(--rose-100)', fontSize: 11.4, fontWeight: 800 }}>#{cancel.id}</span>}
            </div>
            {!cancel || !preview ? <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Chọn <b>"Hủy lịch"</b> hoặc <b>"Hủy đơn & Mở sân"</b> ở một đơn để xử lý.</div> : (
              <>
                <div className="col g6">
                  <label className="label" style={{ margin: 0 }}>Phân loại hủy <span className="req">*</span></label>
                  {([['customer', 'cancel-category-customer', 'Khách báo hủy trước giờ chơi'], ['noshow', 'cancel-category-noshow', 'Khách không đến nhận sân (quá giờ)']] as const).map(([k, tid, l]) => (
                    <label key={k} className={`radio-card${category === k ? ' on' : ''}`}><input type="radio" name="cat" data-testid={tid} checked={category === k} onChange={() => { setCategory(k); setCErr('') }} />{l}</label>
                  ))}
                </div>
                <div className="hint" style={{ background: 'var(--rose-100)', borderColor: 'var(--rose-300)', color: 'var(--rose-950)', padding: 12 }}>
                  {cancel.paid > 0
                    ? <>Khách đã thanh toán <b>{vnd(cancel.paid)}</b> (cọc {vnd(Math.min(cancel.paid, cancel.depositAmount))} luôn được giữ lại). Tỷ lệ hoàn phần ngoài cọc: <b>{preview.rate}%</b> → hoàn <b>{vnd(preview.refund)}</b>, giữ lại <b>{vnd(preview.kept)}</b>. Sân được mở trống để nhận khách mới.</>
                    : <>Đơn chưa phát sinh khoản thanh toán. Khi hủy, khung giờ sẽ được mở trống để nhận khách mới (lượt dùng mã khuyến mãi được hoàn lại).</>}
                </div>
                <div className="col g8">
                  <label className="label" style={{ margin: 0 }}>Lý do hủy đơn</label>
                  <select className="select sm" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                  <input className="input sm" style={{ fontWeight: 500 }} placeholder="Ghi chú thêm (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {cErr && <p className="field-err">{cErr}</p>}
                <button className="btn btn-danger btn-md btn-block" onClick={doCancel}>Xác nhận hủy đơn & Mở trống lại sân</button>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}

function Line({ k, v, green }: { k: string; v: string; green?: boolean }) {
  return <div className="row between g12 t12"><span className={green ? 'c-brand8' : 'c-s600'}>{k}</span><b className={green ? 'c-brand8' : 'c-ink'} style={{ textAlign: 'right' }}>{v}</b></div>
}
