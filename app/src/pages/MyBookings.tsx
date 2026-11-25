import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingStatus,
  type BookingSummaryDto,
} from '@sporthub/shared';
import { useMyBookings } from '../api/bookings.ts';
import { getServerNowMs } from '../api/client.ts';
import BookingDetailModal from '../components/BookingDetailModal.tsx';
import CancelBookingModal from '../components/CancelBookingModal.tsx';
import NotificationInbox from '../components/NotificationInbox.tsx';
import {
  addDays,
  extractErrorMessage,
  fmt,
  formatCountdown,
  formatDateTimeVn,
  formatDepositRule,
  todayVn,
  toVN,
  vnd,
} from '../utils/format.ts';

type StatusTab = 'ALL' | BookingStatus;

const TABS: [StatusTab, string][] = [
  ['ALL', 'Tất cả'],
  ['PENDING_PAYMENT', BOOKING_STATUS_LABELS.PENDING_PAYMENT],
  ['CONFIRMED', BOOKING_STATUS_LABELS.CONFIRMED],
  ['IN_USE', BOOKING_STATUS_LABELS.IN_USE],
  ['COMPLETED', BOOKING_STATUS_LABELS.COMPLETED],
  ['CANCELED', BOOKING_STATUS_LABELS.CANCELED],
  ['EXPIRED', BOOKING_STATUS_LABELS.EXPIRED],
];

const STATUS_BADGE_CLASS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'b-amber',
  CONFIRMED: 'b-green',
  IN_USE: 'b-mint',
  COMPLETED: 'b-gray',
  CANCELED: 'b-rose',
  EXPIRED: 'b-gray',
};

const PAGE_SIZE = 10;

export default function MyBookings() {
  const nav = useNavigate();

  const [tab, setTab] = useState<StatusTab>('ALL');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(() => ({
    from: addDays(todayVn(), -30),
    to: addDays(todayVn(), 60),
  }));
  const [range, setRange] = useState(() => ({
    from: addDays(todayVn(), -30),
    to: addDays(todayVn(), 60),
  }));
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingSummaryDto | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => getServerNowMs());

  const badRange = Boolean(draft.from && draft.to && draft.from > draft.to);

  const bookingsQ = useMyBookings({
    from: range.from,
    to: range.to,
    status: tab,
    page,
    pageSize: PAGE_SIZE,
  });

  const list = bookingsQ.data?.data ?? [];
  const meta = bookingsQ.data?.meta;
  const statusCounts = meta?.statusCounts;
  const totalPages = meta?.totalPages ?? 1;
  const hasPending = list.some((b) => b.status === 'PENDING_PAYMENT');

  useEffect(() => {
    if (!hasPending) return;
    const id = window.setInterval(() => {
      setNowMs(getServerNowMs());
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasPending]);

  const handleEditRange = (k: 'from' | 'to', v: string) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    if (next.from && next.to && next.from <= next.to) {
      setRange(next);
      setPage(1);
    }
  };

  const handleSelectTab = (nextTab: StatusTab) => {
    setTab(nextTab);
    setPage(1);
  };

  const renderBadges = (b: BookingSummaryDto) => {
    if (b.status === 'PENDING_PAYMENT') {
      return (
        <>
          <span className="badge b-amber">{BOOKING_STATUS_LABELS.PENDING_PAYMENT}</span>
          <span className="badge b-gray-o">{PAYMENT_STATUS_LABELS[b.paymentStatus]}</span>
        </>
      );
    }
    if (b.status === 'COMPLETED') {
      return (
        <>
          <span className="badge b-gray">{BOOKING_STATUS_LABELS.COMPLETED}</span>
          <span className="badge b-green-flat">{PAYMENT_STATUS_LABELS[b.paymentStatus]}</span>
        </>
      );
    }
    if (b.status === 'EXPIRED') {
      return <span className="badge b-gray">{BOOKING_STATUS_LABELS.EXPIRED}</span>;
    }
    if (b.status === 'CANCELED') {
      return (
        <>
          <span className="badge b-rose" style={{ background: 'var(--rose-100)' }}>
            {BOOKING_STATUS_LABELS.CANCELED}
          </span>
          {b.cancel && b.cancel.depositKept > 0 && (
            <span className="badge b-rose-soft">
              Không hoàn tiền cọc ({fmt(b.cancel.depositKept)}đ)
            </span>
          )}
        </>
      );
    }
    return (
      <>
        <span className={`badge ${STATUS_BADGE_CLASS[b.status]}`}>
          {BOOKING_STATUS_LABELS[b.status]}
        </span>
        {b.isOverdue && <span className="badge b-rose">Quá giờ nhận sân</span>}
        <span className={`badge ${b.paymentStatus === 'PAID' ? 'b-green-flat' : 'b-teal'}`}>
          {PAYMENT_STATUS_LABELS[b.paymentStatus]}
        </span>
      </>
    );
  };

  const today = todayVn();

  return (
    <>
      <section className="card row between wrap g16">
        <div className="col g2 f1" style={{ minWidth: 220 }}>
          <h1 className="t20 w800 c-ink">Lịch đặt sân của tôi &amp; Thông báo</h1>
          <p className="t12 c-s600">
            Theo dõi các lịch sắp diễn ra, kiểm tra số tiền còn thiếu khi nhận sân và xem tin nhắn
            ưu đãi từ sân.
          </p>
        </div>
        <div className="col g4 myb-date-wrap">
          <div className="row g8 wrap">
            <span className="t12 w600 c-s600">Thời gian đặt:</span>
            <input
              data-testid="my-bookings-from"
              type="date"
              className="input sm myb-date-input"
              value={draft.from}
              onChange={(e) => handleEditRange('from', e.target.value)}
            />
            <span className="t12 w600 c-ink">đến</span>
            <input
              data-testid="my-bookings-to"
              type="date"
              className="input sm myb-date-input"
              value={draft.to}
              onChange={(e) => handleEditRange('to', e.target.value)}
            />
          </div>
          {badRange && (
            <p className="field-err">
              Khoảng thời gian tra cứu không hợp lệ (Từ ngày phải trước hoặc bằng Đến ngày).
            </p>
          )}
        </div>
      </section>

      <div className="grid12">
        <div className="span8 col g16">
          <div className="tabs-scroll">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                data-testid={`tab-${k}`}
                className={`btn ${tab === k ? 'btn-primary' : 'btn-outline'}`}
                style={{ fontWeight: tab === k ? 700 : 600, whiteSpace: 'nowrap', flex: 'none' }}
                onClick={() => handleSelectTab(k)}
              >
                {label} ({statusCounts ? statusCounts[k] : 0})
              </button>
            ))}
          </div>

          {bookingsQ.isLoading && (
            <div className="card center t12 c-s600" style={{ padding: 40 }}>
              Đang tải danh sách lịch đặt sân...
            </div>
          )}

          {bookingsQ.isError && (
            <div className="card col g12 center" style={{ padding: 32 }}>
              <p className="field-err">
                {extractErrorMessage(bookingsQ.error, 'Không thể tải danh sách lịch đặt sân.')}
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void bookingsQ.refetch()}
              >
                Thử lại
              </button>
            </div>
          )}

          {!bookingsQ.isLoading && !bookingsQ.isError && list.length === 0 && (
            <div className="card center t12 c-s600" style={{ padding: 40 }}>
              {(statusCounts?.ALL ?? 0) === 0
                ? 'Bạn chưa có lịch đặt sân nào trong khoảng thời gian đã chọn.'
                : 'Chưa có lịch đặt nào trong mục này.'}
            </div>
          )}

          {!bookingsQ.isLoading &&
            !bookingsQ.isError &&
            list.map((b) => {
              const head = (
                <div className="row between wrap g12 head-rule" style={{ rowGap: 8 }}>
                  <div className="row g10 wrap" style={{ minWidth: 0 }}>
                    <span
                      className="mono t11 w800 c-ink"
                      style={{
                        background: 'var(--s200)',
                        borderRadius: 8,
                        padding: '4px 10px',
                        fontSize: 11.5,
                      }}
                    >
                      #{b.bookingCode}
                    </span>
                    <span className="t14 w800 c-ink break-word">
                      {b.branchName} • {b.courtName}
                    </span>
                  </div>
                  <div className="row g8 wrap">{renderBadges(b)}</div>
                </div>
              );

              const detailBtn = (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setDetailCode(b.bookingCode)}
                >
                  Xem chi tiết
                </button>
              );

              if (b.status === 'COMPLETED') {
                return (
                  <div key={b.bookingCode} className="card col g12">
                    {head}
                    <div className="row between wrap g12">
                      <span className="t12 c-s700">
                        Ngày chơi:{' '}
                        <b>
                          {toVN(b.date)} • {b.startTime} - {b.endTime}
                        </b>{' '}
                        • Tổng thanh toán: <b>{vnd(b.paidAmount)}</b>
                      </span>
                      <div className="row g12">
                        {detailBtn}
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => nav('/booking')}
                        >
                          Đặt lại sân này →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              if (b.status === 'CANCELED') {
                return (
                  <div key={b.bookingCode} className="card col g12" style={{ opacity: 0.9 }}>
                    {head}
                    <p className="t12 c-s600">
                      Lịch chơi:{' '}
                      <b>
                        {toVN(b.date)} • {b.startTime} - {b.endTime}
                      </b>
                      {b.cancel ? (
                        <>
                          {' '}
                          • Đã hủy lúc {formatDateTimeVn(b.cancel.canceledAt)} • Lý do:{' '}
                          <i>&ldquo;{b.cancel.reason}&rdquo;</i>.
                          {b.paidAmount > 0 && (
                            <>
                              {' '}
                              Hoàn {b.cancel.refundRate ?? 0}%:{' '}
                              <b>{vnd(b.cancel.refundAmount ?? 0)}</b> • Giữ lại:{' '}
                              <b>{vnd(b.cancel.depositKept)}</b>.
                            </>
                          )}
                        </>
                      ) : (
                        ' • Đơn đã bị hủy.'
                      )}
                    </p>
                    <div>{detailBtn}</div>
                  </div>
                );
              }

              if (b.status === 'EXPIRED') {
                return (
                  <div key={b.bookingCode} className="card col g12" style={{ opacity: 0.9 }}>
                    {head}
                    <p className="t12 c-s600">
                      Đơn đã quá thời gian giữ chỗ mà chưa thanh toán nên bị hủy tự động. Khung giờ{' '}
                      {toVN(b.date)} • {b.startTime} - {b.endTime} đã được mở lại.
                    </p>
                    <div className="row g12">
                      {detailBtn}
                      <button type="button" className="link-btn" onClick={() => nav('/booking')}>
                        Đặt lại sân này →
                      </button>
                    </div>
                  </div>
                );
              }

              const isPending = b.status === 'PENDING_PAYMENT';
              const canPay = b.allowedActions.includes('PAY');
              const canCancel = b.allowedActions.includes('CANCEL');
              const holdExpireMs = b.holdExpireAt ? Date.parse(b.holdExpireAt) : 0;
              const holdRemainingMs = holdExpireMs > 0 ? Math.max(0, holdExpireMs - nowMs) : 0;
              const dueLabel =
                b.paymentOption === 'FULL'
                  ? '100%'
                  : formatDepositRule(b.deposit.type, b.deposit.value);

              return (
                <div key={b.bookingCode} className="card col g16">
                  {head}
                  <div className="info-grid">
                    <Info k="Thời gian chơi:" v={`${toVN(b.date)} • ${b.startTime} - ${b.endTime}`} />
                    <Info k="Tổng tiền đơn:" v={vnd(b.totalAmount)} />
                    <Info
                      k={
                        isPending || b.paymentStatus === 'PAID'
                          ? 'Đã thanh toán:'
                          : 'Đã đặt cọc:'
                      }
                      v={vnd(b.paidAmount)}
                      cls={isPending ? 'c-s700' : 'c-brand8 w800'}
                    />
                    {isPending ? (
                      <Info
                        k="Cần chuyển khoản:"
                        v={`${vnd(b.amountDueNow)} (${dueLabel})`}
                        cls="c-brand w800"
                      />
                    ) : (
                      <Info
                        k="Cần trả thêm tại sân:"
                        v={vnd(b.remainingAmount)}
                        cls="c-amber w800"
                      />
                    )}
                  </div>
                  <div className="row between wrap g12 top-rule" style={{ rowGap: 12 }}>
                    {isPending ? (
                      <span className="t12 w700 c-amber f1" style={{ minWidth: 200 }}>
                        {holdRemainingMs > 0
                          ? `⏳ Hệ thống đang giữ chỗ tạm thời cho bạn (còn ${formatCountdown(holdRemainingMs)}).`
                          : '⏳ Hết thời gian giữ chỗ, hệ thống đang cập nhật trạng thái...'}
                      </span>
                    ) : b.status === 'IN_USE' ? (
                      <span className="t12 w500 c-s700 f1" style={{ minWidth: 200 }}>
                        🟢 Bạn đang sử dụng sân đến {b.endTime}.
                      </span>
                    ) : b.isOverdue ? (
                      <span className="t12 w700 c-rose f1" style={{ minWidth: 200 }}>
                        ⚠️ Đã quá giờ nhận sân. Vui lòng liên hệ quầy lễ tân.
                      </span>
                    ) : (
                      <span className="t12 w500 c-s700 f1" style={{ minWidth: 200 }}>
                        🔔 Lịch chơi diễn ra lúc {b.startTime}{' '}
                        {b.date === today ? 'hôm nay' : `ngày ${toVN(b.date)}`}. Vui lòng đến quầy
                        lễ tân trước 10 phút để nhận sân.
                      </span>
                    )}
                    <div className="row g8 wrap">
                      {detailBtn}
                      {canPay && (
                        <Link
                          className="btn btn-primary btn-sm"
                          style={{ padding: '6px 16px' }}
                          to={`/payment/${encodeURIComponent(b.bookingCode)}`}
                        >
                          Thanh toán QR ngay
                        </Link>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          data-testid={`cancel-btn-${b.bookingCode}`}
                          className={`btn btn-sm ${isPending ? 'btn-outline' : 'btn-danger-o'}`}
                          style={{ padding: '6px 14px', fontWeight: isPending ? 600 : 700 }}
                          onClick={() => setCancelTarget(b)}
                        >
                          {isPending ? 'Hủy đơn' : 'Hủy lịch đặt'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

          {totalPages > 1 && (
            <div className="row between wrap g12 card" style={{ padding: '12px 16px' }}>
              <span className="t12 c-s600">
                Trang {meta?.page ?? page} / {totalPages} • Tổng {meta?.totalItems ?? 0} đơn
              </span>
              <div className="row g8">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Trước
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Sau →
                </button>
              </div>
            </div>
          )}
        </div>

        <NotificationInbox onSelectBooking={(code) => setDetailCode(code)} />
      </div>

      {detailCode && (
        <BookingDetailModal bookingCode={detailCode} onClose={() => setDetailCode(null)} />
      )}

      {cancelTarget && (
        <CancelBookingModal
          bookingCode={cancelTarget.bookingCode}
          version={cancelTarget.version}
          title={`Xác nhận hủy ${cancelTarget.status === 'PENDING_PAYMENT' ? 'đơn' : 'lịch đặt'} #${cancelTarget.bookingCode}?`}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </>
  );
}

function Info({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="col f1">
      <span className="t12 c-s500">{k}</span>
      <span className={`t12 w700 ${cls ?? 'c-ink'}`}>{v}</span>
    </div>
  );
}
