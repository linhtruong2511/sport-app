import { Link, useNavigate, useParams } from 'react-router-dom'
import { TODAY, branchOf } from '../data'
import { useApp, useNow } from '../appContext'
import VietQrBox from '../components/VietQrBox'
import { mins, toVN, vnd } from '../utils/format'

export default function Payment() {
  const { id } = useParams()
  const { user, bookings, courts, transactions, confirmPayment, cancelBooking, addRecon, toast } = useApp()
  const nav = useNavigate()
  const now = useNow(1000)
  const b = bookings.find((x) => x.id === id)
  const court = b && courts.find((c) => c.id === b.courtId)

  if (!b || !court) return <div className="card col g12 center" style={{ padding: 48 }}><h1 className="t18 w800">Không tìm thấy đơn đặt sân</h1><Link className="btn btn-primary" to="/booking">Đặt sân mới</Link></div>
  // Chỉ chủ đơn (hoặc nhân viên / chủ sân) được xem & thanh toán đơn
  if (user && user.role === 'customer' && b.phone !== user.phone) {
    return (
      <div className="card col g12 center" style={{ padding: 48, maxWidth: 560, margin: '0 auto' }}>
        <h1 className="t18 w800">Không có quyền truy cập đơn đặt sân này</h1>
        <p className="t12 c-s600" style={{ textAlign: 'center' }}>Đơn thuộc về một tài khoản khách hàng khác.</p>
        <Link className="btn btn-primary" to="/my-bookings">Về Lịch đặt của tôi</Link>
      </div>
    )
  }
  const branch = branchOf(court.branchId)
  const hrs = (mins(b.end) - mins(b.start)) / 60
  const when = b.date === TODAY ? 'hôm nay' : toVN(b.date)

  if (b.status !== 'pending') {
    const paidOk = ['confirmed', 'playing', 'overdue', 'completed'].includes(b.status)
    if (paidOk) {
      const txs = transactions.filter((t) => t.bookingId === b.id)
      return (
        <div className="card col g16" style={{ padding: 32, maxWidth: 600, margin: '0 auto' }}>
          <div className="col g4" style={{ alignItems: 'center' }}>
            <span className="center t20 c-white" style={{ width: 52, height: 52, borderRadius: 9999, background: 'var(--brand-600)' }}>✓</span>
            <h1 className="t18 w800 c-ink">Biên nhận thanh toán thành công</h1>
            <p className="t12 c-s600">Đơn #{b.id} đã được xác nhận. Bạn có thể xem chi tiết trong "Lịch đặt của tôi".</p>
          </div>
          <div className="hint col g8">
            <Row k="Sân & Địa điểm:" v={`${court.name} • ${branch.name}`} />
            <Row k="Khung giờ chơi:" v={`${toVN(b.date)} • ${b.start} - ${b.end} (${hrs} giờ)`} />
            <Row k="Tổng tiền thuê sân:" v={vnd(b.total)} />
            <Row k="Đã thanh toán:" v={vnd(b.paid)} />
            <Row k="Còn lại khi nhận sân:" v={vnd(Math.max(0, b.total - b.paid))} />
            {txs.map((t) => <Row key={t.id} k={`Giao dịch ${t.id}:`} v={`${vnd(t.amount)} (${t.method === 'qr' ? 'VietQR' : 'Tiền mặt'}) • ${t.at}`} />)}
          </div>
          <div className="row g8" style={{ justifyContent: 'center' }}><Link className="btn btn-outline" to="/booking">Đặt sân khác</Link><Link className="btn btn-primary" to="/my-bookings">Lịch đặt của tôi</Link></div>
        </div>
      )
    }
    return (
      <div className="card col g12" style={{ padding: 40, alignItems: 'center', maxWidth: 560, margin: '0 auto' }}>
        <h1 className="t18 w800 c-ink">{b.status === 'expired' ? 'Đơn đã quá hạn thanh toán' : 'Đơn đã bị hủy'}</h1>
        <p className="t12 c-s600" style={{ textAlign: 'center' }}>Khung giờ đã được mở lại cho khách khác. Vui lòng đặt lại khung giờ phù hợp.</p>
        <div className="row g8"><Link className="btn btn-outline" to="/booking">Đặt sân khác</Link><Link className="btn btn-primary" to="/my-bookings">Lịch đặt của tôi</Link></div>
      </div>
    )
  }

  const left = Math.max(0, Math.floor(((b.holdUntil ?? now) - now) / 1000))
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0')
  const dueNow = b.payMode === 'full' ? b.total : b.depositAmount // snapshot tại thời điểm đặt (UC 018)
  const pct = Math.round((b.depositAmount / Math.max(1, b.total)) * 100)

  const simulate = (reason: 'WRONG_AMOUNT' | 'WRONG_CONTENT') => {
    addRecon({
      bookingId: b.id, reason, amount: reason === 'WRONG_AMOUNT' ? Math.max(1000, Math.round(dueNow / 2)) : dueNow, expected: dueNow,
      content: reason === 'WRONG_AMOUNT' ? `THANHTOAN ${b.id}` : `chuyen tien ${b.customer}`, bank: `${branch.bankName} • FT${b.id.slice(-6)}`,
    })
    toast('Đã ghi nhận giao dịch bất thường — chuyển sang màn Đối soát. Đơn vẫn chờ thanh toán đúng số tiền.', 'info')
  }

  return (
    <div className="col g24" style={{ maxWidth: 976, margin: '0 auto', width: '100%' }}>
      <div className="row between wrap g16" style={{ background: 'var(--amber-100)', border: '2px solid var(--amber-400)', borderRadius: 16, padding: 16 }}>
        <div className="row g14">
          <span className="center t20 w700 c-white" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--amber-500)' }}>⏳</span>
          <div className="col">
            <span className="t14 w800" style={{ color: 'var(--amber-950)' }}>Đơn đặt sân #{b.id} đang chờ bạn thanh toán</span>
            <span className="t12 w500" style={{ color: 'var(--amber-900)' }}>{court.name} ({b.start} - {b.end} {when}) đang được giữ chỗ cho bạn. Vui lòng quét mã QR trước khi hết thời gian.</span>
          </div>
        </div>
        <div className="col center" style={{ background: '#fff', border: '1px solid var(--amber-400)', borderRadius: 12, padding: '8px 16px' }}>
          <span className="t10 w700 upper" style={{ color: 'var(--s500)', lineHeight: '15px' }}>Thời gian giữ chỗ</span>
          <span className="t18 w800 mono" style={{ color: left < 60 ? 'var(--rose-700)' : 'var(--amber-800)' }}>{mm}:{ss}</span>
        </div>
      </div>

      <div className="grid12">
        <section className="span7 card card-lg col g20">
          <div className="row between g12 head-rule" style={{ paddingBottom: 16 }}>
            <div className="col"><h1 className="t18 w800 c-ink">Quét mã QR để thanh toán</h1><p className="t12 c-s600">Mở ứng dụng Ngân hàng bất kỳ và quét mã VietQR bên dưới</p></div>
            <span className="badge b-green-flat" style={{ border: '1px solid var(--gray-200)', color: 'var(--brand-800)' }}>Xác nhận tự động 24/7</span>
          </div>
          <VietQrBox branch={branch} amount={dueNow} content={`THANHTOAN ${b.id}`} />
          <div className="col g8" style={{ paddingTop: 8 }}>
            <div className="row g12 wrap">
              <button className="btn btn-primary btn-lg f1" onClick={() => { confirmPayment(b.id); toast(`Thanh toán thành công! Đơn #${b.id} đã được xác nhận.`, 'ok'); nav('/my-bookings') }}>✓ Tôi đã hoàn tất chuyển khoản</button>
              <button className="btn btn-outline btn-lg" onClick={() => { cancelBooking(b.id, { reason: 'Khách đổi khung giờ khác', category: 'customer', by: 'customer' }); toast('Đã hủy giữ chỗ. Vui lòng chọn khung giờ khác.'); nav(`/booking?branch=${court.branchId}&sport=${court.sport}&date=${b.date}`) }}>Đổi khung giờ khác</button>
            </div>
            <p className="t11 c-s600" style={{ textAlign: 'center' }}>Hệ thống sẽ tự động xác nhận lịch đặt sân của bạn ngay sau khi nhận được giao dịch chuyển khoản.</p>
            <div className="hint row between wrap g8" style={{ padding: 10 }}>
              <span className="t11 c-s600">Công cụ mô phỏng (demo UC 025):</span>
              <div className="row g8">
                <button type="button" className="btn btn-outline btn-xs" onClick={() => simulate('WRONG_AMOUNT')}>Mô phỏng chuyển sai số tiền</button>
                <button type="button" className="btn btn-outline btn-xs" onClick={() => simulate('WRONG_CONTENT')}>Mô phỏng sai nội dung</button>
              </div>
            </div>
          </div>
        </section>

        <aside className="span5 col g16">
          <div className="card card-lg col g16">
            <div className="row between g12 head-rule">
              <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>Chi tiết đơn #{b.id}</h2>
              <span className="badge b-amber">Chờ thanh toán</span>
            </div>
            <div className="col g10 t12">
              {([
                ['Người đặt sân:', `${b.customer} (${b.phone})`, ''], ['Địa điểm:', `${branch.name} • ${court.name}`, ''],
                ['Khung giờ chơi:', `${toVN(b.date)} • ${b.start} - ${b.end} (${hrs} giờ)`, 'c-brand w800'],
                [`Tổng tiền thuê sân${b.discount ? ` (đã giảm ${Math.round((b.discount / b.subtotal) * 100)}%)` : ''}:`, vnd(b.total), ''],
                [b.payMode === 'full' ? 'Thanh toán đủ 100% ngay:' : `Tiền đặt cọc (${pct}%) thanh toán ngay:`, vnd(dueNow), 'c-brand w800'], ['Còn lại thanh toán khi nhận sân:', vnd(b.total - dueNow), ''],
              ] as const).map(([k, v, c]) => <div className="row between g12" key={k}><span className="c-s600">{k}</span><b className={c || 'c-ink'} style={{ textAlign: 'right' }}>{v}</b></div>)}
              <div className="row between top-rule" style={{ paddingTop: 8 }}><span className="c-s600">Trạng thái thanh toán:</span><b className="c-amber">Chưa thanh toán</b></div>
            </div>
          </div>
          <div className="card col g8">
            <b className="t12 c-ink">Quy định nhận sân & hoàn hủy:</b>
            <p className="t12 c-s700">• Vui lòng có mặt tại quầy lễ tân trước giờ chơi 10 phút để thanh toán phần tiền còn thiếu ({vnd(b.total - dueNow)}) và nhận sân.</p>
            <p className="t12 c-s700">• Tiền đặt cọc không được hoàn lại khi hủy lịch hoặc quá giờ không đến nhận sân. Phần đã trả vượt cọc hoàn 100% nếu hủy trước ≥ 5 ngày, 50% nếu hủy 2 đến dưới 5 ngày, 0% nếu hủy dưới 2 ngày.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="row between g12 t12"><span className="c-s600">{k}</span><b className="c-ink" style={{ textAlign: 'right' }}>{v}</b></div>
}
