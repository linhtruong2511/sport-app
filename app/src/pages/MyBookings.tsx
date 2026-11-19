import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { STATUS_LABEL, TODAY, branchOf, remaining } from '../data'
import type { Booking } from '../data'
import { useApp, useNow } from '../appContext'
import BookingDetailModal from '../components/BookingDetailModal'
import NotificationInbox from '../components/NotificationInbox'
import { calculateRefund } from '../domain/refund'
import { fmt, toVN, vnd } from '../utils/format'

type Tab = 'all' | 'pending' | 'confirmed' | 'playing' | 'completed' | 'expired' | 'cancelled'
const ORDER: Record<string, number> = { confirmed: 0, overdue: 0, playing: 0, pending: 1, completed: 2, expired: 3, cancelled: 3 }
const TABS: [Tab, string][] = [['all', 'Tất cả'], ['pending', 'Chờ thanh toán'], ['confirmed', 'Đã xác nhận'], ['playing', 'Đang sử dụng'], ['completed', 'Hoàn thành'], ['expired', 'Quá hạn thanh toán'], ['cancelled', 'Đã hủy']]
const REASONS = ['Thay đổi kế hoạch cá nhân', 'Bận công việc đột xuất không thể tham gia', 'Đặt nhầm khung giờ', 'Lý do khác']

export default function MyBookings() {
  const { bookings, courts, user, cancelBooking, toast } = useApp()
  const nav = useNavigate()
  const now = useNow(1000)
  const [tab, setTab] = useState<Tab>('all')
  const [draft, setDraft] = useState({ from: '2026-11-01', to: '2026-11-30' })
  const [range, setRange] = useState({ from: '2026-11-01', to: '2026-11-30' })
  const [target, setTarget] = useState<Booking | null>(null)
  const [detail, setDetail] = useState<Booking | null>(null)
  const [reason, setReason] = useState(REASONS[0])
  const [custom, setCustom] = useState('')
  const [cErr, setCErr] = useState('')

  const badRange = draft.from > draft.to
  const edit = (k: 'from' | 'to', v: string) => {
    const d = { ...draft, [k]: v }
    setDraft(d)
    if (d.from && d.to && d.from <= d.to) setRange(d) // khoảng không hợp lệ → giữ nguyên danh sách hiện tại
  }

  const mine = bookings.filter((b) => b.phone === user?.phone && b.date >= range.from && b.date <= range.to)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.date.localeCompare(b.date))
  const grp = (b: Booking): Tab => (b.status === 'overdue' ? 'confirmed' : (b.status as Tab))
  const count = (t: Tab) => (t === 'all' ? mine.length : mine.filter((b) => grp(b) === t).length)
  const list = tab === 'all' ? mine : mine.filter((b) => grp(b) === tab)
  const info = (b: Booking) => { const c = courts.find((x) => x.id === b.courtId)!; return { c, br: branchOf(c.branchId) } }

  const preview = target ? calculateRefund({ playDate: target.date, playStart: target.start, paid: target.paid, depositAmount: target.depositAmount, category: 'customer' }) : null
  const openCancel = (b: Booking) => { setTarget(b); setReason(REASONS[0]); setCustom(''); setCErr('') }
  const doCancel = () => {
    if (!target) return
    let text = reason
    if (reason === 'Lý do khác') {
      if (!custom.trim()) return setCErr('Vui lòng nhập lý do hủy.')
      if (custom.trim().length > 255) return setCErr('Lý do hủy tối đa 255 ký tự.')
      text = custom.trim()
    }
    cancelBooking(target.id, { reason: text, category: 'customer', by: 'customer' })
    toast(`Đã hủy ${target.id}.`)
    setTarget(null)
  }

  return (
    <>
      <section className="card row between wrap g16">
        <div className="col g2">
          <h1 className="t20 w800 c-ink">Lịch đặt sân của tôi & Thông báo</h1>
          <p className="t12 c-s600">Theo dõi các lịch sắp diễn ra, kiểm tra số tiền còn thiếu khi nhận sân và xem tin nhắn ưu đãi từ sân.</p>
        </div>
        <div className="col g4" style={{ alignItems: 'flex-end' }}>
          <div className="row g8 wrap">
            <span className="t12 w600 c-s600">Thời gian đặt:</span>
            <input type="date" className="input sm" style={{ width: 'auto' }} value={draft.from} onChange={(e) => edit('from', e.target.value)} />
            <span className="t12 w600 c-ink">đến</span>
            <input type="date" className="input sm" style={{ width: 'auto' }} value={draft.to} onChange={(e) => edit('to', e.target.value)} />
          </div>
          {badRange && <p className="field-err">Khoảng thời gian tra cứu không hợp lệ (Từ ngày phải trước hoặc bằng Đến ngày).</p>}
        </div>
      </section>

      <div className="grid12">
        <div className="span8 col g16">
          <div className="row g8" style={{ overflow: 'auto', paddingBottom: 4 }}>
            {TABS.map(([k, l]) => (
              <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-outline'}`} style={{ fontWeight: tab === k ? 700 : 600, whiteSpace: 'nowrap' }} onClick={() => setTab(k)}>{l} ({count(k)})</button>
            ))}
          </div>
          {list.length === 0 && <div className="card center t12 c-s600" style={{ padding: 40 }}>{mine.length === 0 ? 'Bạn chưa có lịch đặt sân nào.' : 'Chưa có lịch đặt nào trong mục này.'}</div>}
          {list.map((b) => {
            const { c, br } = info(b)
            const left = remaining(b)
            const head = (
              <div className="row between wrap g12 head-rule" style={{ rowGap: 8 }}>
                <div className="row g10">
                  <span className="mono t11 w800 c-ink" style={{ background: 'var(--s200)', borderRadius: 8, padding: '4px 10px', fontSize: 11.5 }}>#{b.id}</span>
                  <span className="t14 w800 c-ink">{br.name} • {c.name}</span>
                </div>
                <div className="row g8">{badges(b)}</div>
              </div>
            )
            const detailBtn = <button className="link-btn" onClick={() => setDetail(b)}>Xem chi tiết</button>
            if (b.status === 'completed') return (
              <div key={b.id} className="card col g12">{head}
                <div className="row between wrap g12"><span className="t12 c-s700">Ngày chơi: <b>{toVN(b.date)} • {b.start} - {b.end}</b> • Tổng thanh toán: <b>{vnd(b.paid)}</b></span>
                  <div className="row g12">{detailBtn}<button className="link-btn" onClick={() => nav(`/booking?branch=${c.branchId}&sport=${c.sport}`)}>Đặt lại sân này →</button></div></div>
              </div>)
            if (b.status === 'cancelled') return (
              <div key={b.id} className="card col g12" style={{ opacity: 0.9 }}>{head}
                <p className="t12 c-s600">Lịch chơi: <b>{toVN(b.date)} • {b.start} - {b.end}</b> • {b.cancelledAt ? `Đã hủy lúc ${b.cancelledAt}` : 'Đơn đã bị hủy'} • Lý do: <i>"{b.cancelReason ?? 'Không nêu lý do'}"</i>.
                  {b.paid > 0 && <> Hoàn {b.refundRate ?? 0}% phần ngoài cọc: <b>{vnd(b.refundAmount ?? 0)}</b> • Giữ lại: <b>{vnd(b.keptDeposit ?? 0)}</b>.</>}</p>
                <div>{detailBtn}</div></div>)
            if (b.status === 'expired') return (
              <div key={b.id} className="card col g12" style={{ opacity: 0.9 }}>{head}
                <p className="t12 c-s600">Đơn đã quá {10} phút giữ chỗ mà chưa thanh toán nên bị hủy tự động. Khung giờ {toVN(b.date)} • {b.start} - {b.end} đã được mở lại.</p>
                <div className="row g12">{detailBtn}<button className="link-btn" onClick={() => nav(`/booking?branch=${c.branchId}&sport=${c.sport}`)}>Đặt lại sân này →</button></div></div>)
            const isPending = b.status === 'pending'
            const canCancel = b.status === 'pending' || b.status === 'confirmed' // đơn Đang sử dụng / Quá giờ không được khách tự hủy
            const sec = Math.max(0, Math.floor(((b.holdUntil ?? now) - now) / 1000))
            const due = b.payMode === 'full' ? b.total : b.depositAmount
            return (
              <div key={b.id} className="card col g16">{head}
                <div className="row g12" style={{ alignItems: 'flex-start' }}>
                  <Info k="Thời gian chơi:" v={`${toVN(b.date)} • ${b.start} - ${b.end}`} />
                  <Info k="Tổng tiền đơn:" v={vnd(b.total)} />
                  <Info k={isPending || b.paid >= b.total ? 'Đã thanh toán:' : 'Đã đặt cọc:'} v={vnd(b.paid)} cls={isPending ? 'c-s700' : 'c-brand8 w800'} />
                  {isPending ? <Info k="Cần chuyển khoản:" v={`${vnd(due)} (${b.payMode === 'full' ? '100' : Math.round((due / b.total) * 100)}%)`} cls="c-brand w800" />
                    : <Info k="Cần trả thêm tại sân:" v={vnd(left)} cls="c-amber w800" />}
                </div>
                <div className="row between wrap g12 top-rule" style={{ rowGap: 12 }}>
                  {isPending
                    ? <span className="t12 w700 c-amber">⏳ Hệ thống đang giữ chỗ tạm thời cho bạn (còn {String(Math.floor(sec / 60)).padStart(2, '0')} phút {String(sec % 60).padStart(2, '0')} giây).</span>
                    : b.status === 'playing' ? <span className="t12 w500 c-s700">🟢 Bạn đang sử dụng sân đến {b.end}.</span>
                      : b.status === 'overdue' ? <span className="t12 w700 c-rose">⚠️ Đã quá giờ nhận sân. Vui lòng liên hệ quầy lễ tân.</span>
                        : <span className="t12 w500 c-s700">🔔 Lịch chơi diễn ra lúc {b.start} {b.date === TODAY ? 'hôm nay' : `ngày ${toVN(b.date)}`}. Vui lòng đến quầy lễ tân trước 10 phút để nhận sân.</span>}
                  <div className="row g8">
                    {detailBtn}
                    {isPending && <Link className="btn btn-primary btn-sm" style={{ padding: '6px 16px' }} to={`/payment/${b.id}`}>Thanh toán QR ngay</Link>}
                    {canCancel && <button className={`btn btn-sm ${isPending ? 'btn-outline' : 'btn-danger-o'}`} style={{ padding: '6px 14px', fontWeight: isPending ? 600 : 700 }} onClick={() => openCancel(b)}>{isPending ? 'Hủy đơn' : 'Hủy lịch đặt'}</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <NotificationInbox />
      </div>

      {detail && <BookingDetailModal booking={detail} onClose={() => setDetail(null)} />}

      {target && preview && (
        <div className="modal-bg" onClick={() => setTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="t18 w800 c-ink">Xác nhận hủy {target.status === 'pending' ? 'đơn' : 'lịch đặt'} #{target.id}?</h3>
            {target.paid > 0 ? (
              <div className="hint col g6" style={{ background: 'var(--rose-50)', borderColor: 'var(--rose-300)', color: 'var(--rose-950)' }}>
                <span>Theo quy định, tiền đặt cọc <b>{vnd(Math.min(target.paid, target.depositAmount))}</b> sẽ <b>không được hoàn lại</b> khi hủy lịch.</span>
                <span>Phần đã trả vượt cọc: <b>{vnd(Math.max(0, target.paid - target.depositAmount))}</b> — tỷ lệ hoàn dự kiến: <b data-testid="cancel-refund-rate">{preview.rate}%</b> ({preview.days >= 5 ? 'hủy trước từ 5 ngày' : preview.days >= 2 ? 'hủy trước 2 đến dưới 5 ngày' : 'hủy dưới 2 ngày'}).</span>
                <span>Số tiền được hoàn dự kiến: <b data-testid="cancel-refund-amount">{vnd(preview.refund)}</b> • Giữ lại: <b>{vnd(preview.kept)}</b>.</span>
              </div>
            ) : (
              <div className="hint">Đơn chưa phát sinh thanh toán nên không có khoản hoàn tiền. <span data-testid="cancel-refund-rate" hidden>0%</span></div>
            )}
            <div><label className="label">Lý do hủy</label>
              <select className="select" value={reason} onChange={(e) => { setReason(e.target.value); setCErr('') }}>
                {REASONS.map((r) => <option key={r}>{r}</option>)}
              </select></div>
            {reason === 'Lý do khác' && (
              <div><label className="label">Nhập lý do cụ thể (tối đa 255 ký tự) <span className="req">*</span></label>
                <textarea data-testid="cancel-reason-custom" className="input" rows={3} maxLength={255} value={custom} onChange={(e) => { setCustom(e.target.value); setCErr('') }} /></div>
            )}
            {cErr && <p className="field-err">{cErr}</p>}
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-md" onClick={() => setTarget(null)}>Giữ lịch</button>
              <button className="btn btn-danger btn-md" onClick={doCancel}>Xác nhận hủy</button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  function badges(b: Booking) {
    if (b.status === 'pending') return <><span className="badge b-amber">{STATUS_LABEL.pending}</span><span className="badge b-gray-o">Chưa thanh toán</span></>
    if (b.status === 'completed') return <><span className="badge b-gray">Hoàn thành</span><span className="badge b-green-flat">Đã thanh toán đủ</span></>
    if (b.status === 'expired') return <span className="badge b-gray">{STATUS_LABEL.expired}</span>
    if (b.status === 'cancelled') return <><span className="badge b-rose" style={{ background: 'var(--rose-100)' }}>Đã hủy</span>{b.keptDeposit ? <span className="badge b-rose-soft">Không hoàn tiền cọc ({fmt(b.keptDeposit)}đ)</span> : null}</>
    return <><span className="badge b-green">{STATUS_LABEL[b.status]}</span>
      <span className={`badge ${b.paid >= b.total ? 'b-green-flat' : 'b-teal'}`}>{b.paid >= b.total ? 'Đã thanh toán đủ' : `Đã đặt cọc (${Math.round((b.paid / b.total) * 100)}%)`}</span></>
  }
}

function Info({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="col f1"><span className="t12 c-s500">{k}</span><span className={`t12 w700 ${cls ?? 'c-ink'}`}>{v}</span></div>
}
