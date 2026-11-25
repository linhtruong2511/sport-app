import {
  BOOKING_STATUS_LABELS,
  CANCEL_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@sporthub/shared';
import { useBookingDetail } from '../api/bookings.ts';
import {
  formatDateTimeVn,
  formatDepositRule,
  toVN,
  vnd,
} from '../utils/format.ts';

/** Modal chi tiết đơn đặt sân (API-14). */
export default function BookingDetailModal({
  bookingCode,
  onClose,
}: {
  bookingCode: string;
  onClose: () => void;
}) {
  const detailQ = useBookingDetail(bookingCode);
  const b = detailQ.data;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        data-testid="booking-detail-modal"
        style={{ maxWidth: 620, maxHeight: '88vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between wrap g8">
          <h3 className="t18 w800 c-ink">Chi tiết đơn #{bookingCode}</h3>
          {b && (
            <div className="row g6 wrap">
              <span className="badge b-gray">{BOOKING_STATUS_LABELS[b.status]}</span>
              <span className="badge b-sky">{PAYMENT_STATUS_LABELS[b.paymentStatus]}</span>
            </div>
          )}
        </div>

        {detailQ.isLoading && (
          <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
            Đang tải chi tiết đơn...
          </div>
        )}

        {detailQ.isError && (
          <div className="field-err">
            Không thể tải chi tiết đơn đặt sân. Vui lòng thử lại sau.
          </div>
        )}

        {b && (
          <>
            <div className="col g8 t12">
              {(
                [
                  ['Cơ sở:', `${b.branch.name} • ${b.branch.address}`],
                  ['Sân thi đấu:', `${b.court.name} (${b.court.sportName})`],
                  [
                    'Khách hàng:',
                    `${b.customer.fullName} • ${b.customer.phone}${b.customer.isGuest ? ' (Vãng lai)' : ''}`,
                  ],
                  [
                    'Thời gian chơi:',
                    `${toVN(b.date)} • ${b.startTime} - ${b.endTime} (${b.durationMinutes / 60} giờ)`,
                  ],
                  ['Tiền thuê sân gốc:', vnd(b.baseAmount)],
                  [
                    'Khuyến mãi:',
                    b.promotionCode
                      ? `${b.promotionCode} (- ${vnd(b.discountAmount)})`
                      : 'Không áp dụng',
                  ],
                  ['Tổng tiền sau giảm:', vnd(b.totalAmount)],
                  [
                    'Mức đặt cọc (snapshot):',
                    `${formatDepositRule(b.deposit.type, b.deposit.value)} = ${vnd(b.deposit.amount)}`,
                  ],
                  ['Đã thanh toán:', vnd(b.paidAmount)],
                  [
                    'Còn lại phải thu:',
                    vnd(b.status === 'CANCELED' || b.status === 'EXPIRED' ? 0 : b.remainingAmount),
                  ],
                  [
                    'Hình thức:',
                    `${b.paymentOption === 'FULL' ? 'Thanh toán đủ 100%' : 'Đặt cọc giữ sân'} • ${b.channel === 'COUNTER' ? 'Đặt tại quầy' : 'Đặt trực tuyến'}`,
                  ],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div className="row between g12" style={{ alignItems: 'flex-start' }} key={k}>
                  <span className="c-s600 nowrap">{k}</span>
                  <b className="c-ink right break-word">
                    {v}
                  </b>
                </div>
              ))}
            </div>

            {b.priceLines.length > 0 && (
              <div className="col g6">
                <b className="t12 c-ink">Chi tiết khung giá (snapshot)</b>
                <div
                  className="col g4"
                  style={{
                    background: 'var(--s100)',
                    borderRadius: 10,
                    padding: 10,
                    border: '1px solid var(--s200)',
                  }}
                >
                  {b.priceLines.map((pl, idx) => (
                    <div
                      key={`${pl.startTime}-${idx}`}
                      className="row between wrap g8 t11 c-s700"
                    >
                      <span>
                        {pl.label} ({pl.startTime} - {pl.endTime} • {vnd(pl.pricePerHour)}/h)
                      </span>
                      <b className="c-ink">{vnd(pl.amount)}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {b.cancel && (
              <div
                className="hint col g4"
                style={{
                  background: 'var(--rose-50)',
                  borderColor: 'var(--rose-300)',
                  color: 'var(--rose-950)',
                }}
              >
                <div>
                  <b>{CANCEL_TYPE_LABELS[b.cancel.cancelType]}</b> • {formatDateTimeVn(b.cancel.canceledAt)}
                  {b.cancel.canceledByName ? ` (${b.cancel.canceledByName})` : ''}
                </div>
                <div>
                  Lý do: <i>&ldquo;{b.cancel.reason}&rdquo;</i>
                </div>
                <div>
                  Hoàn {b.cancel.refundRate ?? 0}% = <b>{vnd(b.cancel.refundAmount ?? 0)}</b>; giữ lại{' '}
                  <b>{vnd(b.cancel.depositKept)}</b>
                  {b.refund ? ` • Trạng thái hoàn tiền: ${b.refund.status}` : ''}.
                </div>
              </div>
            )}

            {b.payments.length > 0 && (
              <div className="col g6">
                <b className="t12 c-ink">Phiếu thu đã ghi nhận</b>
                {b.payments.map((p) => (
                  <div key={p.paymentCode} className="row between wrap g8 t11 c-s700">
                    <span>
                      <b className="mono c-ink">{p.paymentCode}</b> • {p.method} ({p.purpose}) •{' '}
                      {formatDateTimeVn(p.paidAt)}
                    </span>
                    <b className="c-brand8">{vnd(p.amount)}</b>
                  </div>
                ))}
              </div>
            )}

            {b.transfers.length > 0 && (
              <div className="col g6">
                <b className="t12 c-ink">Lịch sử chuyển sân</b>
                {b.transfers.map((tr, i) => (
                  <div key={i} className="t11 c-s700">
                    {tr.oldCourtName} ({formatDateTimeVn(tr.oldStartAt)}) →{' '}
                    <b className="c-ink">{tr.newCourtName}</b> ({formatDateTimeVn(tr.newStartAt)}) •{' '}
                    {tr.performedByName}
                  </div>
                ))}
              </div>
            )}

            <div className="col g6">
              <b className="t12 c-ink">Lịch sử trạng thái</b>
              {b.statusHistory.map((h, i) => (
                <div key={i} className="row g8 t11" style={{ alignItems: 'flex-start' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 9999,
                      background: 'var(--brand-600)',
                      marginTop: 4,
                      flex: 'none',
                    }}
                  />
                  <span className="c-s700">
                    <b className="c-ink">{formatDateTimeVn(h.changedAt)}</b> —{' '}
                    {BOOKING_STATUS_LABELS[h.toStatus]}
                    {h.note ? ` (${h.note})` : ''}
                    {h.changedByName ? ` • ${h.changedByName}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline btn-md" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
