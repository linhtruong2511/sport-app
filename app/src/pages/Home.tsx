import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FRAMES, SPORTS, TODAY, sportOf } from '../data'
import type { SportKey } from '../data'
import { useApp } from '../appContext'
import { depositLabel, promoActive, promoSummary } from '../domain/pricing'
import { hoursOn, slotsFor } from '../domain/slots'
import { money, toVN } from '../utils/format'

const TONE = { green: 'b-green', sky: 'b-sky', indigo: 'b-indigo', amber: 'b-amber' } as const

export default function Home() {
  const { courts, promos, branches, holidays, blocker, lockAt } = useApp()
  const nav = useNavigate()
  const [f, setF] = useState({ branch: 'cs1', sport: 'pickleball' as SportKey, date: TODAY, frame: FRAMES[3].label })
  const [focusBranch, setFocusBranch] = useState('cs1')
  const count = (k: SportKey) => courts.filter((c) => c.sport === k && c.active).length
  const go = (p: Record<string, string>) => nav(`/booking?${new URLSearchParams(p).toString()}`)
  const search = () => go({ branch: f.branch, sport: f.sport, date: f.date, frame: f.frame })
  const pub = promos.filter((p) => !p.counterOnly && promoActive(p) && p.end >= TODAY)

  // Cụm sân của chi nhánh đang chọn — số khung giờ trống tính động từ lịch đặt, khóa bảo trì & ngày nghỉ
  const fb = branches.find((b) => b.id === focusBranch) ?? branches[0]
  const clusters = SPORTS.map((s) => ({ s, cs: courts.filter((c) => c.branchId === fb.id && c.sport === s.key && c.active) })).filter((x) => x.cs.length)
  const freeSlots = (cs: typeof courts) => {
    const slots = slotsFor(fb, holidays, TODAY)
    let n = 0
    for (const c of cs) for (const sl of slots) if (!blocker(c.id, TODAY, sl.start, sl.end) && !lockAt(c.id, TODAY, sl.start, sl.end)) n++
    return n
  }
  const h = hoursOn(fb, TODAY)

  return (
    <>
      {/* Hero + khung tìm kiếm */}
      <section className="hero col g20" style={{ padding: '32px 32px 28px' }}>
        <span className="badge" style={{ alignSelf: 'flex-start', background: 'rgba(4,120,87,.8)', border: '1px solid rgba(16,185,129,.4)', color: 'var(--brand-100)' }}>
          ⚡ Hệ thống {branches.length} Chi nhánh • {courts.length} Sân tiêu chuẩn thi đấu
        </span>
        <h1 style={{ fontSize: 32, lineHeight: '40px', fontWeight: 800, maxWidth: 700, letterSpacing: -0.4 }}>Tìm sân nhanh, xem giờ trống trực tiếp & giữ sân chỉ trong 1 phút</h1>
        <p className="t14" style={{ maxWidth: 720, color: 'var(--brand-100)', lineHeight: '22.75px' }}>
          Không cần gọi điện chờ đợi. Chọn khung giờ yêu thích trên bảng lịch, thanh toán trọn gói hoặc đặt cọc giữ chỗ qua mã QR và nhận thông báo nhắc lịch trước giờ chơi.
        </p>
        <div className="search-card">
          <div><label className="label">Chi nhánh</label>
            <select className="select" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div><label className="label">Bộ môn thể thao</label>
            <select className="select" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value as SportKey })}>
              {SPORTS.map((s) => <option key={s.key} value={s.key}>{s.label}{s.key === 'pickleball' ? ' (Sân mái che)' : ''}</option>)}
            </select></div>
          <div><label className="label">Ngày chơi</label>
            <input className="input" type="date" value={f.date} min={TODAY} onChange={(e) => setF({ ...f, date: e.target.value || TODAY })} /></div>
          <div><label className="label">Khung giờ</label>
            <select className="select" value={f.frame} onChange={(e) => setF({ ...f, frame: e.target.value })}>
              {FRAMES.map((x) => <option key={x.label}>{x.label}</option>)}
            </select></div>
          <button className="btn btn-primary btn-lg" style={{ height: 44 }} onClick={search}>Tìm sân trống ngay →</button>
        </div>
        <div className="row g8 wrap">
          <span className="t12 w700" style={{ color: 'var(--brand-100)' }}>Bộ môn phổ biến:</span>
          {SPORTS.map((s) => (
            <button key={s.key} className={`sport-chip${f.sport === s.key ? ' on' : ''}`} onClick={() => setF({ ...f, sport: s.key })}>
              {s.emoji} {s.label} ({count(s.key)} sân)
            </button>
          ))}
        </div>
      </section>

      {/* Khuyến mãi */}
      <section className="col g12">
        <div className="row between">
          <div className="col g2">
            <h2 className="t18 w800 c-ink">Mã ưu đãi dành cho bạn</h2>
            <p className="t12 c-s600">Dùng mã giảm giá ở bước đặt sân để tiết kiệm chi phí thuê sân.</p>
          </div>
          <button className="link-btn" onClick={() => nav('/booking')}>Đặt sân & dùng mã →</button>
        </div>
        <div className="row g16" style={{ alignItems: 'stretch' }}>
          {pub.length === 0 && <div className="hint f1" style={{ textAlign: 'center', padding: 24 }}>Hiện chưa có chương trình ưu đãi nào đang chạy.</div>}
          {pub.slice(0, 3).map((p, i) => (
            <div key={p.code} className={`promo-card f1${i === 0 ? ' first' : ''}`}>
              <div className="row between g12">
                <span className={`badge sq ${TONE[p.tone]}`} style={{ padding: '2px 10px', fontSize: 11 }}>{p.tag}</span>
                <span className="code-chip">{p.code}</span>
              </div>
              <h3 className="t14 w800 c-ink" style={{ marginTop: 4 }}>
                Giảm {promoSummary(p)}{p.fromHour === 0 && p.toHour === 24 ? ' tất cả khung giờ' : ` khung ${String(p.fromHour).padStart(2, '0')}:00 - ${String(p.toHour).padStart(2, '0')}:00`}
              </h3>
              <p className="t12 c-s600">{p.scope} • HSD: {toVN(p.end)}</p>
              <div className="row between" style={{ marginTop: 'auto' }}>
                <span />
                <button className="link-btn" onClick={() => go({ promo: p.code })}>Dùng ngay</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Cụm sân & chi nhánh */}
      <section className="grid12">
        <div className="span8 col g16">
          <div className="row between">
            <h2 className="t18 w800 c-ink">Các cụm sân đang mở nhận lịch hôm nay</h2>
            <span className="t12 w600 c-s600">Giá thuê hiển thị theo bảng giá từng sân</span>
          </div>
          <div className="row wrap g16" style={{ alignItems: 'stretch' }}>
            {clusters.map(({ s, cs }) => {
              const rates = cs.flatMap((c) => c.priceRules.map((r) => r.price))
              const lo = Math.min(...rates), hi = Math.max(...rates)
              const free = freeSlots(cs)
              return (
                <div key={s.key} className="cluster" style={{ width: 'calc(50% - 8px)' }}>
                  <div className="cluster-body">
                    <div className="row between">
                      <span className={`badge sq ${TONE[fb.tone]}`} style={{ padding: '2px 10px', fontSize: 11 }}>{fb.name}</span>
                      <span className={`badge ${free ? 'b-green-flat' : 'b-gray-o'}`} style={{ padding: '2px 10px', fontSize: 11 }}>{free ? `● Còn ${free} khung giờ trống` : '● Hết khung giờ trống'}</span>
                    </div>
                    <h3 className="t16 w800 c-ink">Cụm sân {sportOf(s.key).label} ({cs.length} sân)</h3>
                    <p className="t12 c-s600">📍 {fb.address}</p>
                    <div className="row g24" style={{ marginTop: 4 }}>
                      <div className="col"><span className="t11 c-s500">Giờ mở cửa hôm nay:</span><b className="t12 c-ink w800">{h.closed ? 'Đóng cửa' : `${h.open} – ${h.close}`}</b></div>
                      <div className="col"><span className="t11 c-s500">Giá thuê sân:</span><b className="t12 c-brand w800">{money(lo)} - {money(hi)}/h</b></div>
                    </div>
                  </div>
                  <div className="cluster-foot">
                    <span>{s.detail} • cọc từ {depositLabel(cs[0])}</span>
                    <button className="btn btn-primary btn-sm" onClick={() => go({ branch: fb.id, sport: s.key, date: TODAY })}>Chọn giờ đặt</button>
                  </div>
                </div>
              )
            })}
            {clusters.length === 0 && <div className="hint f1" style={{ textAlign: 'center', padding: 24 }}>Chi nhánh này hiện chưa có sân đang hoạt động.</div>}
          </div>
        </div>

        <aside className="span4 col g16">
          <div className="card col g12">
            <div className="row between">
              <h3 className="t14 w800 c-ink">Hệ thống chi nhánh SportHub</h3>
              <span className="t11 w700 c-brand">Khu vực Hà Nội</span>
            </div>
            {branches.map((b) => (
              <button key={b.id} className={`branch-card${focusBranch === b.id ? ' on' : ''}`} onClick={() => { setFocusBranch(b.id); setF((x) => ({ ...x, branch: b.id })) }}>
                <div className="row between"><span className="t12 w800 c-ink">📍 {b.name}</span><span className="t12 w700 c-s800">{courts.filter((c) => c.branchId === b.id).length} sân</span></div>
                <div className="t11 c-s600" style={{ marginTop: 2 }}>{b.address.split(',')[0]} • SĐT: {b.phone}</div>
              </button>
            ))}
          </div>
          <div className="card col g12">
            <h3 className="t14 w800 c-ink">Hướng dẫn đặt lịch nhanh</h3>
            {[
              ['Chọn khung giờ trống:', 'Nhấp trực tiếp vào ô giờ còn trống trên bảng lịch của cơ sở (có thể chọn nhiều khung liền kề).'],
              ['Thanh toán đủ hoặc đặt cọc:', 'Quét mã VietQR để giữ sân ngay lập tức mà không cần chờ duyệt.'],
              ['Nhận sân đúng giờ:', 'Hệ thống gửi thông báo nhắc lịch trước 1 tiếng. Lưu ý tiền đặt cọc không được hoàn lại khi hủy đơn hoặc quá giờ không đến nhận sân.'],
            ].map(([a, b], i) => (
              <div className="row g12" key={a} style={{ alignItems: 'flex-start' }}>
                <span className="step-no">{i + 1}</span>
                <p className="t12 c-s700" style={{ lineHeight: '19px' }}><b className="c-ink">{a}</b> {b}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </>
  )
}
