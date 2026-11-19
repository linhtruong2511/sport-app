import { useState } from 'react'
import type { ReconciliationItem } from '../data'
import { useApp } from '../appContext'
import { vnd } from '../utils/format'

const REASON: Record<ReconciliationItem['reason'], string> = { WRONG_AMOUNT: 'Sai số tiền', WRONG_CONTENT: 'Sai nội dung chuyển khoản', LATE: 'Chuyển trễ hạn giữ chỗ' }
const STATUS: Record<ReconciliationItem['status'], [string, string]> = { OPEN: ['b-amber', 'Cần đối soát'], MATCHED: ['b-green', 'Đã khớp đơn'], REFUNDED: ['b-sky', 'Đã hoàn lại khách'], IGNORED: ['b-gray', 'Đã bỏ qua'] }

/** Màn hình bổ sung (Mục 5.9): Đối soát giao dịch (UC 005/012/025) & Khoản hoàn tiền chờ xử lý (UC 009). */
export default function Reconciliation() {
  const { reconciliations, refunds, bookings, confirmPayment, setReconStatus, markRefundDone, toast } = useApp()
  const [tab, setTab] = useState<'recon' | 'refund'>('recon')
  const [pick, setPick] = useState<Record<string, string>>({})
  const open = reconciliations.filter((r) => r.status === 'OPEN').length
  const pend = refunds.filter((r) => r.status === 'PENDING')
  const pendingBookings = bookings.filter((b) => b.status === 'pending')

  const match = (r: ReconciliationItem) => {
    const id = r.bookingId ?? pick[r.id]
    if (!id) return toast('Vui lòng chọn đơn cần gán giao dịch.', 'err')
    const b = bookings.find((x) => x.id === id)
    if (!b || b.status !== 'pending') return toast(`Đơn #${id} không còn ở trạng thái Chờ thanh toán — hãy hoàn tiền lại cho khách.`, 'err')
    confirmPayment(id)
    setReconStatus(r.id, 'MATCHED')
    toast(`Đã khớp giao dịch vào đơn #${id} — đơn được xác nhận.`, 'ok')
  }

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          <button className={`btn btn-md ${tab === 'recon' ? 'btn-primary' : 'btn-ghost'}`} style={{ background: tab === 'recon' ? undefined : 'var(--s100)' }} onClick={() => setTab('recon')}>Giao dịch cần đối soát ({open})</button>
          <button className={`btn btn-md ${tab === 'refund' ? 'btn-primary' : 'btn-ghost'}`} style={{ background: tab === 'refund' ? undefined : 'var(--s100)' }} onClick={() => setTab('refund')}>Khoản hoàn tiền chờ xử lý ({pend.length})</button>
        </div>
        <span className="t12 c-s600">Tổng tiền hoàn chờ xử lý: <b className="c-rose">{vnd(pend.reduce((s, r) => s + r.amount, 0))}</b></span>
      </section>

      {tab === 'recon' ? (
        <section className="card col g12">
          <div className="col g2"><h2 className="t14 w800 c-ink">Danh sách giao dịch bất thường</h2><span className="t12 c-s600">Giao dịch chuyển sai số tiền, sai nội dung hoặc về sau khi đơn đã hết hạn giữ chỗ.</span></div>
          {reconciliations.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Không có giao dịch nào cần đối soát.</div>}
          {reconciliations.map((r) => (
            <div key={r.id} data-testid={`recon-${r.id}`} className="row between g12 wrap" style={{ border: '1px solid var(--s300)', borderRadius: 12, padding: 14, background: r.status === 'OPEN' ? 'var(--amber-50)' : 'var(--s50)' }}>
              <div className="col g4">
                <div className="row g8"><b className="t12 c-ink mono">{r.id}</b><span className={`badge ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}</span><span className="badge b-gray-o">{REASON[r.reason]}</span></div>
                <span className="t12 c-s700">Nhận {vnd(r.amount)}{r.expected ? ` (đơn cần ${vnd(r.expected)})` : ''} • Nội dung: <i>"{r.content}"</i></span>
                <span className="t11 c-s600">{r.bank} • {r.at}{r.bookingId ? ` • Đơn #${r.bookingId}` : ' • Chưa gắn đơn'}</span>
              </div>
              {r.status === 'OPEN' && (
                <div className="row g8 wrap">
                  {!r.bookingId && (
                    <select className="select sm fit" value={pick[r.id] ?? ''} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })} aria-label="Chọn đơn để gán">
                      <option value="">— Gán vào đơn —</option>
                      {pendingBookings.map((b) => <option key={b.id} value={b.id}>#{b.id} • {b.customer}</option>)}
                    </select>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={() => match(r)}>Khớp vào đơn</button>
                  <button className="btn btn-warn-o btn-sm" onClick={() => { setReconStatus(r.id, 'REFUNDED'); toast('Đã đánh dấu hoàn lại tiền cho khách.', 'ok') }}>Hoàn lại khách</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setReconStatus(r.id, 'IGNORED')}>Bỏ qua</button>
                </div>
              )}
            </div>
          ))}
        </section>
      ) : (
        <section className="card col g12">
          <div className="col g2"><h2 className="t14 w800 c-ink">Khoản hoàn tiền sau khi hủy đơn</h2><span className="t12 c-s600">Hoàn 100% (≥ 5 ngày) hoặc 50% (2 đến &lt; 5 ngày) phần đã trả vượt tiền cọc; đơn đóng do cơ sở hoàn trả ngoài hệ thống.</span></div>
          {refunds.length === 0 && <div className="hint" style={{ textAlign: 'center', padding: 24 }}>Chưa có khoản hoàn tiền nào phát sinh.</div>}
          {refunds.map((r) => (
            <div key={r.id} className="row between g12 wrap" style={{ border: '1px solid var(--s300)', borderRadius: 12, padding: 14, background: r.status === 'PENDING' ? 'var(--amber-50)' : 'var(--s50)' }}>
              <div className="col g4">
                <div className="row g8"><b className="t12 c-ink mono">#{r.bookingId}</b><span className={`badge ${r.status === 'PENDING' ? 'b-amber' : 'b-green'}`}>{r.status === 'PENDING' ? 'Chờ hoàn tiền' : 'Đã hoàn tiền'}</span></div>
                <span className="t12 c-s700">{r.customer} ({r.phone}) • Hoàn {r.rate}% = <b>{vnd(r.amount)}</b></span>
                <span className="t11 c-s600">{r.at}{r.note ? ` • ${r.note}` : ''}</span>
              </div>
              {r.status === 'PENDING' && <button className="btn btn-primary btn-sm" onClick={() => { markRefundDone(r.id); toast(`Đã đánh dấu hoàn ${vnd(r.amount)} cho ${r.customer}.`, 'ok') }}>Đánh dấu đã hoàn tiền</button>}
            </div>
          ))}
        </section>
      )}
    </>
  )
}
