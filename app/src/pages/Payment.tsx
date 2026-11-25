import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@sporthub/shared';
import { bookingsKeys, useBookingDetail } from '../api/bookings.ts';
import { ApiError, getServerNowMs } from '../api/client.ts';
import {
  createPaymentRequestApi,
  paymentsKeys,
  recheckPaymentRequestApi,
  usePaymentRequest,
} from '../api/payments.ts';
import { queryClient } from '../api/queryClient.ts';
import { getSocket, subscribeRoom, unsubscribeRoom } from '../api/socket.ts';
import CancelBookingModal from '../components/CancelBookingModal.tsx';
import VietQrBox from '../components/VietQrBox.tsx';
import { useToast } from '../ui/toastContext.ts';
import {
  extractErrorMessage,
  formatCountdown,
  formatDateTimeVn,
  todayVn,
  toVN,
  vnd,
} from '../utils/format.ts';

export default function Payment() {
  const { bookingCode } = useParams<{ bookingCode: string }>();
  const { toast } = useToast();

  const detailQ = useBookingDetail(bookingCode);
  const b = detailQ.data;
  const isPending = b?.status === 'PENDING_PAYMENT';

  const paymentQ = usePaymentRequest(bookingCode, { enabled: isPending });
  const pr = paymentQ.data;

  const [nowMs, setNowMs] = useState<number>(() => getServerNowMs());
  const [isRechecking, setIsRechecking] = useState(false);
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(getServerNowMs());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!bookingCode) return;
    const room = { channel: 'booking', bookingCode } as const;
    subscribeRoom(room);

    const socket = getSocket();
    const handleReconnect = () => {
      subscribeRoom(room);
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('connect', handleReconnect);
      unsubscribeRoom(room);
    };
  }, [bookingCode]);

  if (!bookingCode) {
    return (
      <div className="card status-card col g12 center">
        <h1 className="t18 w800">Không tìm thấy mã đơn đặt sân</h1>
        <Link className="btn btn-primary" to="/booking">
          Đặt sân mới
        </Link>
      </div>
    );
  }

  if (detailQ.isLoading) {
    return (
      <div className="card status-card col g12 center">
        <span className="t14 c-s600">Đang tải thông tin thanh toán đơn #{bookingCode}...</span>
      </div>
    );
  }

  if (detailQ.isError || !b) {
    const err = detailQ.error;
    const isForbidden = err instanceof ApiError && err.status === 403;
    return (
      <div className="card status-card col g12 center">
        <h1 className="t18 w800 c-ink" style={{ textAlign: 'center' }}>
          {isForbidden ? 'Không có quyền truy cập đơn đặt sân này' : 'Không tìm thấy đơn đặt sân'}
        </h1>
        <p className="t12 c-s600" style={{ textAlign: 'center' }}>
          {extractErrorMessage(err, 'Đơn đặt sân không tồn tại hoặc bạn không có quyền xem.')}
        </p>
        <div className="row g8 wrap center">
          <Link className="btn btn-outline" to="/booking">
            Đặt sân mới
          </Link>
          <Link className="btn btn-primary" to="/my-bookings">
            Về Lịch đặt của tôi
          </Link>
        </div>
      </div>
    );
  }

  if (b.status === 'CONFIRMED' || b.status === 'IN_USE' || b.status === 'COMPLETED') {
    const hrs = b.durationMinutes / 60;
    return (
      <div className="card status-card col g16">
        <div className="col g4" style={{ alignItems: 'center' }}>
          <span
            className="center t20 c-white"
            style={{
              width: 52,
              height: 52,
              borderRadius: 9999,
              background: 'var(--brand-600)',
            }}
          >
            ✓
          </span>
          <h1 className="t18 w800 c-ink" style={{ textAlign: 'center' }}>
            Biên nhận thanh toán thành công
          </h1>
          <p className="t12 c-s600" style={{ textAlign: 'center' }}>
            Đơn #{b.bookingCode} ({BOOKING_STATUS_LABELS[b.status]} •{' '}
            {PAYMENT_STATUS_LABELS[b.paymentStatus]}). Bạn có thể xem chi tiết trong &ldquo;Lịch đặt
            của tôi&rdquo;.
          </p>
        </div>
        <div className="hint col g8">
          <Row k="Sân & Địa điểm:" v={`${b.court.name} • ${b.branch.name}`} />
          <Row
            k="Khung giờ chơi:"
            v={`${toVN(b.date)} • ${b.startTime} - ${b.endTime} (${hrs} giờ)`}
          />
          {b.promotionCode && (
            <Row
              k="Khuyến mãi:"
              v={`${b.promotionCode} (- ${vnd(b.discountAmount)})`}
            />
          )}
          <Row k="Tổng tiền thuê sân:" v={vnd(b.totalAmount)} />
          <Row k="Đã thanh toán:" v={vnd(b.paidAmount)} />
          <Row k="Còn lại khi nhận sân:" v={vnd(b.remainingAmount)} />
          {b.payments.map((p) => (
            <Row
              key={p.paymentCode}
              k={`Giao dịch ${p.paymentCode}:`}
              v={`${vnd(p.amount)} (${p.method === 'BANK_TRANSFER' ? 'VietQR' : 'Tiền mặt'}) • ${formatDateTimeVn(p.paidAt)}`}
            />
          ))}
        </div>
        <div className="row g8 wrap center">
          <Link className="btn btn-outline" to="/booking">
            Đặt sân khác
          </Link>
          <Link className="btn btn-primary" to="/my-bookings">
            Lịch đặt của tôi
          </Link>
        </div>
      </div>
    );
  }

  if (b.status === 'EXPIRED' || b.status === 'CANCELED') {
    const isExpired = b.status === 'EXPIRED';
    return (
      <div className="card status-card col g12" style={{ alignItems: 'center' }}>
        <h1 className="t18 w800 c-ink" style={{ textAlign: 'center' }}>
          {isExpired ? 'Đơn đã quá hạn thanh toán' : 'Đơn đặt sân đã bị hủy'}
        </h1>
        <p className="t12 c-s600" style={{ textAlign: 'center' }}>
          {isExpired
            ? 'Đơn đã hết thời gian giữ chỗ nên khung giờ đã được mở lại cho khách khác. Vui lòng đặt lại khung giờ phù hợp.'
            : b.cancel
              ? `Đơn #${b.bookingCode} đã bị hủy (${b.cancel.reason}).`
              : `Đơn #${b.bookingCode} đã bị hủy và khung giờ đã được mở lại.`}
        </p>
        <div className="row g8 wrap center">
          <Link className="btn btn-outline" to="/my-bookings">
            Lịch đặt của tôi
          </Link>
          <Link className="btn btn-primary" to="/booking">
            Đặt lại sân mới
          </Link>
        </div>
      </div>
    );
  }

  const hrs = b.durationMinutes / 60;
  const when = b.date === todayVn() ? 'hôm nay' : toVN(b.date);

  const holdExpireMs = b.holdExpireAt ? Date.parse(b.holdExpireAt) : 0;
  const holdRemainingMs = holdExpireMs > 0 ? Math.max(0, holdExpireMs - nowMs) : 0;
  const holdAlive = holdExpireMs > nowMs;

  const qrExpireMs = pr?.expiresAt ? Date.parse(pr.expiresAt) : 0;
  const qrRemainingMs = qrExpireMs > 0 ? Math.max(0, qrExpireMs - nowMs) : 0;
  const isQrActive = Boolean(pr && pr.status === 'PENDING' && qrExpireMs > nowMs);

  const canCancel = b.allowedActions.includes('CANCEL');
  const paymentIsMissing =
    !paymentQ.isLoading &&
    ((paymentQ.isError && paymentQ.error instanceof ApiError && paymentQ.error.status === 404) ||
      !isQrActive);

  const handleRecheck = async () => {
    if (!pr) return;
    setIsRechecking(true);
    try {
      const res = await recheckPaymentRequestApi(pr.requestId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingCode) }),
        queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
        queryClient.invalidateQueries({ queryKey: paymentsKeys.request(bookingCode) }),
      ]);
      toast(res.message, res.status === 'PAID' ? 'ok' : 'info');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast(err.message || 'Bạn thao tác quá nhanh, vui lòng thử lại sau.', 'err');
      } else if (err instanceof ApiError && err.status === 502) {
        toast(err.message || 'Không thể kết nối cổng thanh toán, vui lòng thử lại sau.', 'err');
      } else {
        toast(extractErrorMessage(err), 'err');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingCode) }),
        queryClient.invalidateQueries({ queryKey: paymentsKeys.request(bookingCode) }),
      ]);
    } finally {
      setIsRechecking(false);
    }
  };

  const handleCreateQr = async () => {
    setIsCreatingQr(true);
    try {
      await createPaymentRequestApi(bookingCode, {}, crypto.randomUUID());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: paymentsKeys.request(bookingCode) }),
        queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingCode) }),
      ]);
      toast('Đã tạo mã QR thanh toán mới.', 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingsKeys.detail(bookingCode) }),
        queryClient.invalidateQueries({ queryKey: paymentsKeys.request(bookingCode) }),
      ]);
    } finally {
      setIsCreatingQr(false);
    }
  };

  return (
    <>
      <div className="col g24" style={{ maxWidth: 976, margin: '0 auto', width: '100%' }}>
        <div className="row between wrap g16 hold-banner">
          <div className="row g14 f1" style={{ alignItems: 'flex-start' }}>
            <span
              className="center t20 w700 c-white"
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--amber-500)',
                flex: 'none',
              }}
            >
              ⏳
            </span>
            <div className="col f1">
              <span className="t14 w800" style={{ color: 'var(--amber-950)' }}>
                Đơn đặt sân #{b.bookingCode} đang chờ bạn thanh toán
              </span>
              <span className="t12 w500" style={{ color: 'var(--amber-900)' }}>
                {b.court.name} ({b.startTime} - {b.endTime} {when}) đang được giữ chỗ cho bạn. Vui
                lòng quét mã QR trước khi hết thời gian.
              </span>
            </div>
          </div>
          <div className="col center hold-timer-box">
            <span className="t10 w700 upper" style={{ color: 'var(--s500)', lineHeight: '15px' }}>
              Thời gian giữ chỗ
            </span>
            <span
              data-testid="hold-countdown"
              className="t18 w800 mono"
              style={{
                color: holdRemainingMs < 60_000 ? 'var(--rose-700)' : 'var(--amber-800)',
              }}
            >
              {formatCountdown(holdRemainingMs)}
            </span>
          </div>
        </div>

        <div className="grid12">
          <section className="span7 card card-lg col g20">
            <div className="row between wrap g12 head-rule" style={{ paddingBottom: 16 }}>
              <div className="col">
                <h1 className="t18 w800 c-ink">Quét mã QR để thanh toán</h1>
                <p className="t12 c-s600">
                  Mở ứng dụng Ngân hàng bất kỳ và quét mã VietQR bên dưới
                </p>
              </div>
              <div className="qr-head-meta">
                <span
                  className="badge b-green-flat"
                  style={{ border: '1px solid var(--gray-200)', color: 'var(--brand-800)' }}
                >
                  Xác nhận tự động 24/7
                </span>
                {isQrActive && (
                  <span className="t11 c-s600 mono" data-testid="qr-countdown">
                    Hiệu lực QR: {formatCountdown(qrRemainingMs)}
                  </span>
                )}
              </div>
            </div>

            {paymentQ.isLoading && (
              <div className="hint" style={{ textAlign: 'center', padding: 32 }}>
                Đang tải mã thanh toán VietQR...
              </div>
            )}

            {!paymentQ.isLoading && isQrActive && pr && (
              <>
                <VietQrBox
                  qrPayload={pr.qrPayload}
                  bankName={pr.bank.bankName}
                  bankAccountNo={pr.bank.accountNo}
                  bankAccountName={pr.bank.accountName}
                  amount={pr.amount}
                  transferContent={pr.transferContent}
                />
                <div className="col g8" style={{ paddingTop: 8 }}>
                  <div className="row g12 wrap">
                    <button
                      type="button"
                      data-testid="recheck-payment-btn"
                      className="btn btn-primary btn-lg f1"
                      disabled={isRechecking}
                      onClick={() => void handleRecheck()}
                    >
                      {isRechecking ? 'Đang kiểm tra giao dịch...' : 'Kiểm tra lại giao dịch'}
                    </button>
                    {canCancel && (
                      <button
                        type="button"
                        data-testid="cancel-hold-btn"
                        className="btn btn-outline btn-lg"
                        onClick={() => setShowCancelModal(true)}
                      >
                        Hủy đơn giữ chỗ
                      </button>
                    )}
                  </div>
                  <p className="t11 c-s600" style={{ textAlign: 'center' }}>
                    Hệ thống sẽ tự động xác nhận lịch đặt sân của bạn ngay sau khi nhận được giao
                    dịch chuyển khoản.
                  </p>
                </div>
              </>
            )}

            {!paymentQ.isLoading && paymentIsMissing && (
              <div className="col g16">
                {paymentQ.isError &&
                  !(paymentQ.error instanceof ApiError && paymentQ.error.status === 404) && (
                    <div className="field-err">
                      {extractErrorMessage(
                        paymentQ.error,
                        'Không thể tải thông tin mã thanh toán.',
                      )}
                    </div>
                  )}

                {holdAlive ? (
                  <div
                    className="hint col g12"
                    style={{
                      background: 'var(--amber-50)',
                      borderColor: 'var(--amber-300)',
                      padding: 20,
                    }}
                  >
                    <b className="t14 c-amber9">
                      {pr ? 'Mã QR hiện tại đã hết hiệu lực' : 'Chưa có mã QR đang hoạt động'}
                    </b>
                    <p className="t12 c-s700">
                      Đơn #{b.bookingCode} vẫn đang trong thời gian giữ chỗ. Vui lòng tạo mã QR
                      mới để hoàn tất thanh toán.
                    </p>
                    <div className="row g12 wrap">
                      <button
                        type="button"
                        data-testid="create-qr-btn"
                        className="btn btn-primary btn-lg"
                        disabled={isCreatingQr}
                        onClick={() => void handleCreateQr()}
                      >
                        {isCreatingQr ? 'Đang tạo mã QR...' : 'Tạo mã QR mới'}
                      </button>
                      {canCancel && (
                        <button
                          type="button"
                          data-testid="cancel-hold-btn"
                          className="btn btn-outline btn-lg"
                          onClick={() => setShowCancelModal(true)}
                        >
                          Hủy đơn giữ chỗ
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className="hint col g12"
                    style={{
                      background: 'var(--rose-50)',
                      borderColor: 'var(--rose-300)',
                      padding: 20,
                    }}
                  >
                    <b className="t14 c-rose">Đã hết thời gian giữ chỗ</b>
                    <p className="t12 c-s700">
                      Hệ thống đang cập nhật trạng thái hết hạn cho đơn #{b.bookingCode}. Bạn có
                      thể tải lại trạng thái hoặc quay lại đặt khung giờ mới.
                    </p>
                    <div className="row g12 wrap">
                      <button
                        type="button"
                        className="btn btn-outline btn-md"
                        onClick={() => void detailQ.refetch()}
                      >
                        Tải lại trạng thái
                      </button>
                      <Link className="btn btn-primary btn-md" to="/booking">
                        Đặt sân khác
                      </Link>
                      {canCancel && (
                        <button
                          type="button"
                          data-testid="cancel-hold-btn"
                          className="btn btn-danger-o btn-md"
                          onClick={() => setShowCancelModal(true)}
                        >
                          Hủy đơn giữ chỗ
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="span5 col g16">
            <div className="card card-lg col g16">
              <div className="row between wrap g8 head-rule">
                <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
                  Chi tiết đơn #{b.bookingCode}
                </h2>
                <span className="badge b-amber">{BOOKING_STATUS_LABELS[b.status]}</span>
              </div>
              <div className="col g10 t12">
                {(
                  [
                    ['Người đặt sân:', `${b.customer.fullName} (${b.customer.phone})`, ''],
                    ['Địa điểm:', `${b.branch.name} • ${b.court.name}`, ''],
                    [
                      'Khung giờ chơi:',
                      `${toVN(b.date)} • ${b.startTime} - ${b.endTime} (${hrs} giờ)`,
                      'c-brand w800',
                    ],
                    ...(b.promotionCode
                      ? ([
                          [
                            `Khuyến mãi (${b.promotionCode}):`,
                            `- ${vnd(b.discountAmount)}`,
                            'c-brand8 w700',
                          ],
                        ] as const)
                      : []),
                    ['Tổng tiền thuê sân:', vnd(b.totalAmount), ''],
                    [
                      b.paymentOption === 'FULL'
                        ? 'Thanh toán đủ 100% ngay:'
                        : 'Tiền đặt cọc thanh toán ngay:',
                      vnd(b.amountDueNow),
                      'c-brand w800',
                    ],
                    ['Còn lại thanh toán khi nhận sân:', vnd(b.remainingAmount), ''],
                  ] as const
                ).map(([k, v, cls]) => (
                  <div className="row between g12" style={{ alignItems: 'flex-start' }} key={k}>
                    <span className="c-s600">{k}</span>
                    <b className={`${cls || 'c-ink'} right break-word`}>
                      {v}
                    </b>
                  </div>
                ))}
                <div className="row between wrap g8 top-rule" style={{ paddingTop: 8 }}>
                  <span className="c-s600">Trạng thái thanh toán:</span>
                  <b className="c-amber">{PAYMENT_STATUS_LABELS[b.paymentStatus]}</b>
                </div>
              </div>
            </div>
            <div className="card col g8">
              <b className="t12 c-ink">Quy định nhận sân &amp; hoàn hủy:</b>
              <p className="t12 c-s700">
                • Vui lòng có mặt tại quầy lễ tân trước giờ chơi 10 phút để thanh toán phần tiền
                còn thiếu ({vnd(b.remainingAmount)}) và nhận sân.
              </p>
              <p className="t12 c-s700">
                • Tiền đặt cọc không được hoàn lại khi hủy lịch hoặc quá giờ không đến nhận sân.
                Phần đã trả vượt cọc hoàn 100% nếu hủy trước ≥ 5 ngày, 50% nếu hủy 2 đến dưới 5
                ngày, 0% nếu hủy dưới 2 ngày.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {showCancelModal && (
        <CancelBookingModal
          bookingCode={b.bookingCode}
          version={b.version}
          title={`Xác nhận hủy đơn giữ chỗ #${b.bookingCode}?`}
          onClose={() => setShowCancelModal(false)}
        />
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row between g12 t12" style={{ alignItems: 'flex-start' }}>
      <span className="c-s600">{k}</span>
      <b className="c-ink right break-word">
        {v}
      </b>
    </div>
  );
}
