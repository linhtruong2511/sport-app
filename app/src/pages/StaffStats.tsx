import { useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { DEMO_NOW_TIME, STATUS_LABEL, TODAY, branchOf, remaining, retainedOf } from '../data'
import type { Booking } from '../data'
import type { StaffOutlet } from '../layouts'
import { useApp } from '../appContext'
import { computeDailyStats } from '../domain/reports'
import { fmt, money, toVN, vnd } from '../utils/format'

type Kpi = 'total' | 'playing' | 'pending' | 'revenue'

export default function StaffStats() {
  const { bookings, courts, locks, transactions, checkIn, toast } = useApp()
  const { branchFilter } = useOutletContext<StaffOutlet>()
  const nav = useNavigate()
  const [drill, setDrill] = useState<Kpi | null>(null)
  const label = branchFilter === 'all' ? 'toàn hệ thống' : branchOf(branchFilter).name
  const st = computeDailyStats({ bookings, courts, locks, txs: transactions, branchId: branchFilter, date: TODAY })
  const todays = st.rows
  const lockToday = (id: string) => locks.find((l) => l.courtId === id && l.from.slice(0, 10) <= TODAY && l.to.slice(0, 10) >= TODAY)
  const bCourts = st.courts
  const playingN = st.playingCourtIds.length, maint = st.maintCourtIds.length
  const waitingPay = st.waitingPay.length, waitingPick = st.waitingPick.length
  const soon = todays.filter((b) => b.status === 'confirmed' && b.start >= DEMO_NOW_TIME).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3)
  const upcoming = [...soon, ...todays.filter((b) => b.status === 'overdue')]
  const cName = (id: string) => courts.find((c) => c.id === id)?.name ?? ''

  const drillRows: Record<Kpi, { title: string; list: Booking[] }> = {
    total: { title: 'Tổng lượt đặt hôm nay', list: st.live },
    playing: { title: 'Các sân đang có khách chơi', list: todays.filter((b) => b.status === 'playing') },
    pending: { title: 'Đơn chờ nhận sân / tất toán', list: [...st.waitingPay, ...st.waitingPick] },
    revenue: { title: 'Các đơn cấu thành doanh thu thực thu', list: todays.filter((b) => retainedOf(b) > 0) },
  }
  const act = (b: Booking) => {
    if (b.status === 'overdue') return nav(`/staff/orders?bookingId=${b.id}`)
    if (remaining(b) > 0) return nav(`/staff/orders?bookingId=${b.id}`)
    const r = checkIn(b.id)
    if (!r.ok) return toast(r.error ?? 'Không thể nhận sân.', 'err')
    toast(`Đã giao ${cName(b.courtId)} cho khách.`, 'ok')
  }

  return (
    <>
      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <Stat id="kpi-total-bookings" onClick={() => setDrill('total')} label="Tổng lượt đặt hôm nay" icon="📅" bg="var(--brand-100)" color="var(--s900)" value={`${st.live.length} lượt đặt`} sub={`${st.online} đơn đặt online • ${st.counter} đơn đặt tại quầy`} />
        <Stat id="kpi-playing-courts" onClick={() => setDrill('playing')} label="Số sân đang có khách chơi" icon="🟢" bg="var(--brand-100)" color="var(--brand-800)" value={`${playingN} / ${bCourts.length} sân`} sub={`${bCourts.length - playingN - maint} sân đang trống • ${maint} sân đang bảo trì`} />
        <Stat id="kpi-pending-orders" onClick={() => setDrill('pending')} label="Đơn chờ nhận sân / tất toán" icon="⏳" bg="var(--amber-100)" color="var(--amber-800)" value={`${waitingPay + waitingPick} đơn`} sub={`${waitingPay} đơn chờ chuyển khoản • ${waitingPick} đơn chờ nhận sân`} />
        <button type="button" data-testid="kpi-revenue" className="hero col g8 f1" style={{ padding: 20, borderRadius: 16, textAlign: 'left', cursor: 'pointer' }} onClick={() => setDrill('revenue')}>
          <div className="row between"><span className="t12 w700" style={{ color: 'var(--brand-100)' }}>Doanh thu thực thu hôm nay</span><span className="center t16 w800" style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--brand-600)' }}>₫</span></div>
          <div className="t24 w800">{vnd(st.revenue)}</div>
          <p className="t12" style={{ color: 'var(--brand-100)' }}>Chuyển khoản: {money(st.qr)} • Tiền mặt: {money(st.cash)}</p>
        </button>
      </div>

      <div className="grid12">
        <section className="span7 card col g16">
          <div className="row between">
            <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Tình trạng hoạt động các sân tại {label}</h2>
            <Link to="/staff/booking" className="link-btn">+ Đặt sân mới tại quầy →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {bCourts.map((c) => {
              const lk = lockToday(c.id)
              const bk = todays.find((b) => b.courtId === c.id && b.status === 'playing')
              const next = todays.filter((b) => b.courtId === c.id && (b.status === 'confirmed' || b.status === 'overdue')).sort((a, b) => a.start.localeCompare(b.start))[0]
              const base = { borderRadius: 12, padding: 14, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } as const
              if (lk) return (
                <div key={c.id} style={{ ...base, background: 'var(--s200)', border: '1px solid var(--s300)' }}>
                  <div className="col"><b className="t12 c-s800 w800">{c.name}</b><b className="t12 c-s700">🔒 {lk.mode === 'stop' ? 'Ngừng khai thác' : 'Đang bảo trì mặt sân'}</b><span className="t11 c-s600">{lk.mode === 'stop' ? 'Không thời hạn' : `${lk.from.slice(8, 10)}/${lk.from.slice(5, 7)} ${lk.from.slice(11)} – ${lk.to.slice(8, 10)}/${lk.to.slice(5, 7)} ${lk.to.slice(11)}`}</span></div>
                  <span className="badge sq c-white" style={{ background: 'var(--s500)', fontSize: 10 }}>Tạm khóa</span>
                </div>)
              if (bk) return (
                <div key={c.id} style={{ ...base, background: 'rgba(236,253,245,.7)', border: '2px solid var(--brand-500)' }}>
                  <div className="col"><b className="t12 c-ink w800">{c.name}</b><b className="t12 c-brand9">Đang sử dụng • #{bk.id}</b><span className="t11 c-s600">Khách: {bk.customer} • Hết giờ: {bk.end}</span></div>
                  <span className="badge sq c-white" style={{ background: remaining(bk) === 0 ? 'var(--brand-700)' : 'var(--amber-800)', fontSize: 10 }}>{remaining(bk) === 0 ? 'Đã thu đủ' : 'Còn thiếu'}</span>
                </div>)
              return (
                <div key={c.id} style={{ ...base, background: '#fff', border: '1px solid var(--s300)' }}>
                  <div className="col"><b className="t12 c-ink w800">{c.name}{branchFilter === 'all' ? ` (${branchOf(c.branchId).short})` : ''}</b><b className="t12 c-brand">Đang trống khung hiện tại</b>
                    <span className="t11 c-s600">{next ? `Có lịch khách đặt lúc ${next.start} (#BK${next.id.slice(-4)})` : 'Chưa có lịch tiếp theo hôm nay'}</span></div>
                  <button className="btn btn-primary btn-sm" style={{ fontSize: 11 }} onClick={() => nav(`/staff/booking?courtId=${c.id}`)}>Lập đơn</button>
                </div>)
            })}
          </div>
          <div className="hint col g8" style={{ padding: 16 }}>
            <b className="c-ink">Chi tiết tiền thực thu trong ca hôm nay ({vnd(st.revenue)}):</b>
            <div className="row g12" style={{ paddingTop: 4 }}>
              {([['Đơn đã thu đủ 100%:', st.fullAmt, 'c-ink'], ['Tiền cọc mới thu hôm nay:', st.partAmt, 'c-brand'], ['Tiền cọc đơn hủy giữ lại:', st.keptAmt, 'c-amber']] as const).map(([k, v, c]) => (
                <div key={k} className="f1 col" style={{ background: '#fff', border: '1px solid var(--s300)', borderRadius: 8, padding: 12 }}><span className="c-s500">{k}</span><b className={`t14 w800 ${c}`}>{fmt(v)} VNĐ</b></div>
              ))}
            </div>
          </div>
        </section>

        <section className="span5 card col g16">
          <div className="row between head-rule">
            <div className="col"><h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Lịch khách sắp đến nhận sân</h2><p className="t12 c-s600">Các đơn sắp bắt đầu và đơn quá giờ chưa nhận sân</p></div>
            <Link to="/staff/orders" className="link-btn">Xem toàn bộ →</Link>
          </div>
          <div className="col g12">
            {upcoming.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Hiện không có đơn nào sắp đến giờ nhận sân.</div>}
            {upcoming.slice(0, 4).map((b) => {
              const rem = remaining(b), late = b.status === 'overdue'
              const tone = late ? { bg: 'var(--rose-50)', bd: '2px solid var(--rose-300)', chip: 'var(--rose-200)', cc: 'var(--rose-950)', t: 'Khách trễ 30 phút' }
                : rem > 0 ? { bg: 'var(--amber-50)', bd: '2px solid var(--amber-400)', chip: 'var(--amber-200)', cc: 'var(--amber-950)', t: `Cần thu thêm ${money(rem)}` }
                  : { bg: 'var(--s50)', bd: '1px solid var(--s300)', chip: 'var(--brand-100)', cc: 'var(--brand-900)', t: `Đã thanh toán đủ ${money(b.total)}` }
              return (
                <div key={b.id} className="col g8" style={{ background: tone.bg, border: tone.bd, borderRadius: 12, padding: 16 }}>
                  <div className="row between g8"><b className="t12 c-ink w800">#{b.id} • {cName(b.courtId)}</b><span className="badge sq" style={{ background: tone.chip, color: tone.cc, padding: '2px 10px' }}>{tone.t}</span></div>
                  <p className="t12 c-s700">Khách: <b>{b.customer} ({b.phone})</b>{late ? <> • Đã đặt cọc {money(b.paid)} nhưng chưa đến nhận sân.</> : <> • Giờ chơi: <b>{b.start} - {b.end}</b></>}</p>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className={`btn ${late ? 'btn-danger' : 'btn-primary'} btn-sm`} style={{ padding: '6px 14px' }} onClick={() => act(b)}>{late ? 'Hủy lịch & Mở sân' : rem > 0 ? 'Thu tiền & Giao sân' : 'Giao sân ngay'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {drill && (
        <div className="modal-bg" onClick={() => setDrill(null)}>
          <div className="modal" data-testid="kpi-drilldown-modal" style={{ maxWidth: 640, maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="row between"><h3 className="t18 w800 c-ink">{drillRows[drill].title}</h3><span className="badge b-gray">{drillRows[drill].list.length} đơn • {toVN(TODAY)}</span></div>
            {drillRows[drill].list.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 20 }}>Không có đơn nào.</div>}
            <div className="col g8">
              {drillRows[drill].list.map((b) => (
                <div key={b.id} className="row between g12" style={{ border: '1px solid var(--s300)', borderRadius: 10, padding: 10 }}>
                  <div className="col"><b className="t12 c-ink mono">#{b.id}</b><span className="t12 c-s700">{b.customer} • {cName(b.courtId)} • {b.start} - {b.end}</span></div>
                  <div className="col" style={{ alignItems: 'flex-end' }}><span className="badge b-gray">{STATUS_LABEL[b.status]}</span><span className="t11 c-s600">Đã thu {vnd(retainedOf(b))} / {vnd(b.total)}</span></div>
                </div>
              ))}
            </div>
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-md" onClick={() => setDrill(null)}>Đóng</button>
              <button className="btn btn-primary btn-md" onClick={() => nav('/staff/orders')}>Mở Quản lý đơn →</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Stat({ id, onClick, label, icon, bg, color, value, sub }: { id: string; onClick: () => void; label: string; icon: string; bg: string; color: string; value: string; sub: string }) {
  return (
    <button type="button" data-testid={id} onClick={onClick} className="card col g8 f1" style={{ textAlign: 'left', cursor: 'pointer' }}>
      <div className="row between"><span className="t12 w700 c-s600">{label}</span><span className="center t16 w700" style={{ width: 36, height: 36, borderRadius: 12, background: bg, color }}>{icon}</span></div>
      <div className="t24 w800" style={{ color }}>{value}</div>
      <p className="t12 c-s600">{sub}</p>
    </button>
  )
}
