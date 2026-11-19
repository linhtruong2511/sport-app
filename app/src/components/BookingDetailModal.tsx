import { STATUS_LABEL, branchOf } from '../data'
import type { Booking } from '../data'
import { useApp } from '../appContext'
import { mins, toVN, vnd } from '../utils/format'

/** Modal chi tiết đơn đặt sân (UC 006 Bước 3, Mục 5.9): cơ sở, giá thuê, khuyến mãi, thanh toán, lịch sử trạng thái. */
export default function BookingDetailModal({ booking: b, onClose }: { booking: Booking; onClose: () => void }) {
  const { courts } = useApp()
  const court = courts.find((c) => c.id === b.courtId)
  const br = court ? branchOf(court.branchId) : undefined
  const hours = (mins(b.end) - mins(b.start)) / 60
  const rows: [string, string][] = [
    ['Cơ sở:', br ? `${br.name} • ${br.address}` : '—'],
    ['Sân thi đấu:', court?.name ?? b.courtId],
    ['Thời gian chơi:', `${toVN(b.date)} • ${b.start} - ${b.end} (${hours} giờ)`],
    ['Đơn giá bình quân:', `${vnd(b.unitPriceSnap)}/giờ`],
    ['Tiền thuê sân gốc:', vnd(b.subtotal)],
    ['Khuyến mãi:', b.promo ? `${b.promo} (- ${vnd(b.discount)})` : 'Không áp dụng'],
    ['Tổng tiền sau giảm:', vnd(b.total)],
    ['Tiền đặt cọc (snapshot):', vnd(b.depositAmount)],
    ['Đã thanh toán:', vnd(b.paid)],
    ['Còn lại khi nhận sân:', vnd(b.status === 'cancelled' || b.status === 'expired' ? 0 : Math.max(0, b.total - b.paid))],
    ['Hình thức:', `${b.payMode === 'full' ? 'Thanh toán đủ 100%' : 'Đặt cọc giữ sân'} • ${b.source === 'counter' ? 'Đặt tại quầy' : 'Đặt trực tuyến'}`],
  ]
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" data-testid="booking-detail-modal" style={{ maxWidth: 580, maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="row between g12">
          <h3 className="t18 w800 c-ink">Chi tiết đơn #{b.id}</h3>
          <span className="badge b-gray">{STATUS_LABEL[b.status]}</span>
        </div>
        <div className="col g8 t12">
          {rows.map(([k, v]) => <div className="row between g12" key={k}><span className="c-s600">{k}</span><b className="c-ink" style={{ textAlign: 'right' }}>{v}</b></div>)}
        </div>
        {b.status === 'cancelled' && (
          <div className="hint" style={{ background: 'var(--rose-50)', borderColor: 'var(--rose-300)', color: 'var(--rose-950)' }}>
            Lý do hủy: <i>"{b.cancelReason ?? '—'}"</i>. Hoàn {b.refundRate ?? 0}% phần ngoài cọc = <b>{vnd(b.refundAmount ?? 0)}</b>; giữ lại <b>{vnd(b.keptDeposit ?? 0)}</b>.
          </div>
        )}
        <div className="col g6">
          <b className="t12 c-ink">Lịch sử trạng thái</b>
          {b.history.map((h, i) => (
            <div key={i} className="row g8 t11" style={{ alignItems: 'flex-start' }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: 'var(--brand-600)', marginTop: 4, flex: 'none' }} />
              <span className="c-s700"><b className="c-ink">{h.at}</b> — {h.text}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-outline btn-md" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  )
}
