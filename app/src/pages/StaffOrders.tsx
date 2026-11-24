import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type BookingSummaryDto,
  type PaymentMethod,
  type PaymentRequestDto,
} from '@sporthub/shared';
import { availabilityKeys } from '../api/availability.ts';
import {
  bookingsKeys,
  cancelBookingApi,
  useBookingDetail,
  useCancelPreview,
} from '../api/bookings.ts';
import { getServerNowMs } from '../api/client.ts';
import { dashboardKeys } from '../api/dashboard.ts';
import {
  createPaymentRequestApi,
  recheckPaymentRequestApi,
} from '../api/payments.ts';
import {
  checkInPosBookingApi,
  completePosBookingApi,
  posKeys,
  settlePosBookingApi,
  usePosBookings,
  type PosBookingsTab,
} from '../api/pos.ts';
import { queryClient } from '../api/queryClient.ts';
import { subscribeRoom, unsubscribeRoom } from '../api/socket.ts';
import AffectedBookingsModal from '../components/AffectedBookingsModal.tsx';
import BookingDetailModal from '../components/BookingDetailModal.tsx';
import VietQrBox from '../components/VietQrBox.tsx';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import {
  extractErrorMessage,
  formatCountdown,
  formatDateTimeVn,
  kfmt,
  toVN,
  todayVn,
  vnd,
} from '../utils/format.ts';

type OrdersTab = PosBookingsTab | 'AFFECTED';

const CANCEL_REASONS = [
  'Khách yêu cầu hủy lịch',
  'Khách bận việc đột xuất',
  'Đặt nhầm khung giờ',
  'Lý do khác',
];

function statusBadgeClass(b: BookingSummaryDto): string {
  if (b.isOverdue) return 'b-amber';
  switch (b.status) {
    case 'CONFIRMED':
      return 'b-sky';
    case 'IN_USE':
      return 'b-mint';
    case 'PENDING_PAYMENT':
      return 'b-amber';
    case 'COMPLETED':
      return 'b-gray';
    case 'CANCELED':
      return 'b-rose';
    case 'EXPIRED':
      return 'b-gray';
  }
}

export default function StaffOrders() {
  const { activeBranchId, branches } = useOutletContext<StaffOutlet>();
  const { toast } = useToast();
  const [sp] = useSearchParams();
  const initialQuery = sp.get('bookingId') ?? sp.get('bookingCode') ?? '';

  const today = todayVn();
  const [date, setDate] = useState(today);
  const [tab, setTab] = useState<OrdersTab>('ALL');
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [committedQ, setCommittedQ] = useState(initialQuery);
  const [page, setPage] = useState(1);

  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [settleTarget, setSettleTarget] = useState<BookingSummaryDto | null>(null);
  const [settleMethod, setSettleMethod] = useState<PaymentMethod>('CASH');
  const [settleCheckIn, setSettleCheckIn] = useState(true);
  const [settleQr, setSettleQr] = useState<PaymentRequestDto | null>(null);
  const [settleBusy, setSettleBusy] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<BookingSummaryDto | null>(null);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [cancelCustomReason, setCancelCustomReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const [noShowTarget, setNoShowTarget] = useState<BookingSummaryDto | null>(null);
  const [noShowBusy, setNoShowBusy] = useState(false);

  const [rowBusyCode, setRowBusyCode] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => getServerNowMs());

  const bookingsQ = usePosBookings(
    activeBranchId
      ? {
          branchId: activeBranchId,
          date,
          tab: tab === 'AFFECTED' ? 'ALL' : tab,
          q: committedQ || undefined,
          page,
          pageSize: 20,
        }
      : null,
    { enabled: Boolean(activeBranchId) },
  );

  const cancelPreviewQ = useCancelPreview(
    cancelTarget?.bookingCode,
    'CUSTOMER_REQUEST',
    { enabled: Boolean(cancelTarget) },
  );

  const settleBookingCode =
    settleTarget && settleMethod === 'BANK_TRANSFER' ? settleTarget.bookingCode : null;
  const settleDetailQ = useBookingDetail(settleBookingCode, {
    enabled: Boolean(settleBookingCode),
  });

  useEffect(() => {
    if (!settleBookingCode) return;
    subscribeRoom({ channel: 'booking', bookingCode: settleBookingCode });
    return () => {
      unsubscribeRoom({ channel: 'booking', bookingCode: settleBookingCode });
    };
  }, [settleBookingCode]);

  useEffect(() => {
    if (!settleQr) return;
    const timer = window.setInterval(() => {
      setNowMs(getServerNowMs());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [settleQr]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: posKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
      queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
    ]);
  };

  useEffect(() => {
    const detail = settleDetailQ.data;
    if (!settleTarget || settleMethod !== 'BANK_TRANSFER' || !detail) return;
    if (detail.bookingCode !== settleTarget.bookingCode) return;

    if (detail.remainingAmount === 0) {
      const finalizeQrSettle = async () => {
        if (settleCheckIn && detail.allowedActions.includes('CHECK_IN')) {
          try {
            await checkInPosBookingApi(detail.bookingCode, { version: detail.version });
          } catch {
            // Ignore auto check-in failure if outside check-in window; payment itself succeeded
          }
        }
        await invalidateAll();
        toast(`Đã tất toán VietQR thành công cho đơn #${detail.bookingCode}.`, 'ok');
        setSettleTarget(null);
        setSettleQr(null);
      };
      void finalizeQrSettle();
    }
  }, [settleDetailQ.data, settleTarget, settleMethod, settleCheckIn, toast]);

  const activeBranchName =
    branches.find((b) => b.branchId === activeBranchId)?.name ?? 'Chi nhánh hiện tại';

  const items = bookingsQ.data?.data ?? [];
  const meta = bookingsQ.data?.meta;
  const tabCounts = meta?.tabCounts;

  const dayLabel = date === today ? 'hôm nay' : `ngày ${toVN(date)}`;
  const tabs: Array<[OrdersTab, string]> = [
    ['ALL', `Tất cả đơn ${dayLabel}`],
    ['WAITING', 'Chờ khách nhận sân'],
    ['IN_USE', 'Đang chơi trên sân'],
    ['OVERDUE', 'Quá giờ nhận sân'],
    ['PENDING_PAYMENT', 'Chờ thanh toán'],
    ['COMPLETED', 'Hoàn thành'],
    ['CANCELED', 'Đã hủy'],
    ['EXPIRED', 'Quá hạn thanh toán'],
    ['AFFECTED', 'Đơn bị ảnh hưởng'],
  ];

  const openSettleModal = (b: BookingSummaryDto) => {
    setSettleTarget(b);
    setSettleMethod('CASH');
    setSettleCheckIn(true);
    setSettleQr(null);
  };

  const handleSelectSettleMethod = async (nextMethod: PaymentMethod) => {
    setSettleMethod(nextMethod);
    if (nextMethod === 'BANK_TRANSFER' && settleTarget && !settleQr) {
      setSettleBusy(true);
      try {
        const qr = await createPaymentRequestApi(
          settleTarget.bookingCode,
          { purpose: 'REMAINING' },
          crypto.randomUUID(),
        );
        setSettleQr(qr);
        setNowMs(getServerNowMs());
      } catch (err) {
        toast(extractErrorMessage(err), 'err');
      } finally {
        setSettleBusy(false);
      }
    }
  };

  const handleConfirmCashSettle = async () => {
    if (!settleTarget) return;
    setSettleBusy(true);
    try {
      const res = await settlePosBookingApi(
        settleTarget.bookingCode,
        {
          method: 'CASH',
          amount: settleTarget.remainingAmount,
          checkIn: settleCheckIn,
          version: settleTarget.version,
        },
        crypto.randomUUID(),
      );
      await invalidateAll();
      toast(
        settleCheckIn && res.booking.status === 'IN_USE'
          ? `Đã thu đủ ${vnd(res.receipt.amount)} & bàn giao sân cho đơn #${res.booking.bookingCode}.`
          : `Đã thu đủ ${vnd(res.receipt.amount)} cho đơn #${res.booking.bookingCode}.`,
        'ok',
      );
      setSettleTarget(null);
      setSettleQr(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setSettleBusy(false);
    }
  };

  const handleRecheckSettleQr = async () => {
    if (!settleTarget || !settleQr) return;
    setSettleBusy(true);
    try {
      const res = await recheckPaymentRequestApi(settleQr.requestId);
      if (res.status === 'PAID' || res.booking?.remainingAmount === 0) {
        if (settleCheckIn && res.booking && res.booking.status === 'CONFIRMED') {
          try {
            await checkInPosBookingApi(settleTarget.bookingCode, {
              version: res.booking.version,
            });
          } catch {
            // Outside check-in window; staff can check in manually later
          }
        }
        await invalidateAll();
        toast(`Đã xác nhận tất toán VietQR cho đơn #${settleTarget.bookingCode}.`, 'ok');
        setSettleTarget(null);
        setSettleQr(null);
      } else {
        toast(res.message || 'Chưa nhận được giao dịch chuyển khoản.', 'info');
      }
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setSettleBusy(false);
    }
  };

  const handleRegenerateSettleQr = async () => {
    if (!settleTarget) return;
    setSettleBusy(true);
    try {
      const qr = await createPaymentRequestApi(
        settleTarget.bookingCode,
        { purpose: 'REMAINING' },
        crypto.randomUUID(),
      );
      setSettleQr(qr);
      setNowMs(getServerNowMs());
      toast('Đã tạo lại mã VietQR tất toán.', 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setSettleBusy(false);
    }
  };

  const handleCheckIn = async (b: BookingSummaryDto) => {
    setRowBusyCode(b.bookingCode);
    try {
      await checkInPosBookingApi(b.bookingCode, { version: b.version });
      await invalidateAll();
      toast(`Đã bàn giao ${b.courtName} cho khách (#${b.bookingCode}).`, 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setRowBusyCode(null);
    }
  };

  const handleComplete = async (b: BookingSummaryDto) => {
    setRowBusyCode(b.bookingCode);
    try {
      await completePosBookingApi(b.bookingCode, { version: b.version });
      await invalidateAll();
      toast(`Đơn #${b.bookingCode} đã hoàn thành.`, 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setRowBusyCode(null);
    }
  };

  const handleConfirmNoShow = async () => {
    if (!noShowTarget) return;
    setNoShowBusy(true);
    try {
      await cancelBookingApi(noShowTarget.bookingCode, {
        cancelType: 'NO_SHOW',
        reason: 'Khách không đến nhận sân',
        version: noShowTarget.version,
      });
      await invalidateAll();
      toast(`Đã hủy đơn quá giờ #${noShowTarget.bookingCode} & mở trống sân.`, 'ok');
      setNoShowTarget(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setNoShowBusy(false);
    }
  };

  const openCancelModal = (b: BookingSummaryDto) => {
    setCancelTarget(b);
    setCancelReason(CANCEL_REASONS[0]);
    setCancelCustomReason('');
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    const finalReason =
      cancelReason === 'Lý do khác'
        ? cancelCustomReason.trim()
        : cancelCustomReason.trim()
          ? `${cancelReason} – ${cancelCustomReason.trim()}`
          : cancelReason;

    if (!finalReason) {
      toast('Vui lòng nhập lý do hủy đơn.', 'err');
      return;
    }

    setCancelBusy(true);
    try {
      await cancelBookingApi(cancelTarget.bookingCode, {
        cancelType: 'CUSTOMER_REQUEST',
        reason: finalReason.slice(0, 255),
        version: cancelTarget.version,
      });
      await invalidateAll();
      toast(`Đã hủy đơn #${cancelTarget.bookingCode} & giải phóng sân.`, 'ok');
      setCancelTarget(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-testid={k === 'AFFECTED' ? 'affected-orders-tab' : undefined}
              className={`btn btn-md ${tab === k ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                padding: '8px 14px',
                background: tab === k ? undefined : 'var(--s100)',
                fontWeight: tab === k ? 700 : 600,
              }}
              onClick={() => {
                setTab(k);
                setPage(1);
              }}
            >
              {label} ({tabCounts?.[k] ?? 0})
            </button>
          ))}
        </div>

        <div className="row g8 wrap">
          <input
            data-testid="orders-date-filter"
            type="date"
            className="input sm"
            style={{ width: 'auto' }}
            value={date}
            onChange={(e) => {
              setDate(e.target.value || today);
              setPage(1);
            }}
          />
          <input
            className="input sm"
            style={{ width: 240, background: 'var(--s50)', padding: '8px 14px', borderRadius: 12 }}
            placeholder="Mã đơn, tên hoặc SĐT khách"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setCommittedQ(searchInput.trim());
                setPage(1);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-dark"
            onClick={() => {
              setCommittedQ(searchInput.trim());
              setPage(1);
            }}
          >
            Tìm đơn
          </button>
        </div>
      </section>

      <section className="card col g16">
        {tab === 'AFFECTED' ? (
          <>
            <div className="col g2">
              <h2 className="t14 w800 c-ink">
                Đơn đặt sân bị ảnh hưởng — {activeBranchName}
              </h2>
              <span className="t12 c-s600">
                Do sân bảo trì / ngừng khai thác / ngày nghỉ / đổi giờ mở cửa. Chọn Chuyển sân / Đổi giờ hoặc Đóng đơn do cơ sở.
              </span>
            </div>
            <AffectedBookingsModal
              branchId={activeBranchId}
              testId="affected-orders-list"
              emptyText="Hiện không có đơn nào bị ảnh hưởng tại chi nhánh này."
            />
          </>
        ) : (
          <>
            <div className="row between wrap g8">
              <h2 className="t14 w800 c-ink">
                Danh sách lịch đặt sân ngày {toVN(date)} — {activeBranchName}
              </h2>
              <span className="t12 w500 c-s600">
                Lưu ý: Thu đủ 100% tiền sân trước khi bấm Nhận sân
              </span>
            </div>

            {bookingsQ.isLoading ? (
              <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
                Đang tải danh sách đơn đặt sân...
              </div>
            ) : bookingsQ.isError ? (
              <div className="field-err">
                {extractErrorMessage(bookingsQ.error, 'Không thể tải danh sách đơn đặt sân.')}
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Mã đơn / Khách hàng</th>
                      <th>Sân & Giờ chơi</th>
                      <th>Thanh toán</th>
                      <th>Trạng thái</th>
                      <th className="r">Xử lý</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}
                        >
                          Không có đơn nào phù hợp.
                        </td>
                      </tr>
                    )}
                    {items.map((b) => {
                      const closed = b.status === 'CANCELED' || b.status === 'EXPIRED';
                      const isRowBusy = rowBusyCode === b.bookingCode;
                      return (
                        <tr
                          key={b.bookingCode}
                          className={
                            settleTarget?.bookingCode === b.bookingCode
                              ? 'hl'
                              : b.isOverdue
                                ? 'warn-row'
                                : undefined
                          }
                        >
                          <td>
                            <div className="code mono">#{b.bookingCode}</div>
                            <div className="w700 c-s800">{b.customerName}</div>
                            <div className="t11 c-s600">
                              {b.customerPhone}
                              {b.isGuest ? ' (Khách vãng lai)' : ''}
                            </div>
                          </td>
                          <td>
                            <div className="w800 c-ink">{b.courtName}</div>
                            <div
                              className={`w700 ${b.isOverdue ? 'c-rose' : 'c-brand8'}`}
                              style={
                                b.isOverdue
                                  ? undefined
                                  : b.status === 'CONFIRMED'
                                    ? { color: 'var(--s700)', fontWeight: 600 }
                                    : undefined
                              }
                            >
                              {b.startTime} - {b.endTime}
                              {b.isOverdue ? ' (Quá giờ nhận sân)' : ''}
                            </div>
                            {(b.checkedInAt || b.checkedOutAt) && (
                              <div className="t11 c-s600">
                                {b.checkedInAt && `Nhận sân: ${formatDateTimeVn(b.checkedInAt)}`}
                                {b.checkedOutAt && ` • Trả sân: ${formatDateTimeVn(b.checkedOutAt)}`}
                              </div>
                            )}
                          </td>
                          <td>
                            <div>
                              Tổng: <b>{vnd(b.totalAmount)}</b>
                              {b.paidAmount > 0 && b.remainingAmount > 0
                                ? ` (Đã thu: ${kfmt(b.paidAmount)})`
                                : ''}
                            </div>
                            {closed ? (
                              <div className="c-s600">
                                {b.status === 'CANCELED'
                                  ? `Đã hủy${
                                      b.cancel && b.cancel.refundAmount !== null
                                        ? ` • Hoàn ${b.cancel.refundRate ?? 0}%: ${vnd(b.cancel.refundAmount)}`
                                        : ''
                                    }`
                                  : 'Quá hạn thanh toán'}
                              </div>
                            ) : b.remainingAmount > 0 ? (
                              <div
                                className="w800"
                                style={{
                                  color: b.isOverdue ? 'var(--amber-800)' : 'var(--rose-700)',
                                }}
                              >
                                Còn thiếu: {vnd(b.remainingAmount)}
                              </div>
                            ) : (
                              <div className="w700 c-brand8">Còn thiếu: 0 VNĐ</div>
                            )}
                            {!closed && (
                              <span
                                className={`badge sq ${
                                  b.paymentStatus === 'PAID' ? 'b-green' : 'b-amber'
                                }`}
                                style={{ fontSize: 10, padding: '2px 8px', marginTop: 4 }}
                              >
                                {PAYMENT_STATUS_LABELS[b.paymentStatus]}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${statusBadgeClass(b)}`}>
                              {b.isOverdue ? 'Quá giờ nhận sân' : BOOKING_STATUS_LABELS[b.status]}
                            </span>
                          </td>
                          <td className="r">
                            <div className="row g6 wrap" style={{ justifyContent: 'flex-end' }}>
                              {b.allowedActions.includes('SETTLE') && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={isRowBusy}
                                  onClick={() => openSettleModal(b)}
                                >
                                  Thu nốt {kfmt(b.remainingAmount)} & Nhận sân
                                </button>
                              )}
                              {b.allowedActions.includes('CHECK_IN') && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={isRowBusy}
                                  onClick={() => void handleCheckIn(b)}
                                >
                                  {isRowBusy ? 'Đang xử lý...' : 'Nhận sân ngay'}
                                </button>
                              )}
                              {b.allowedActions.includes('COMPLETE') && (
                                <button
                                  type="button"
                                  className="btn btn-dark btn-sm"
                                  disabled={isRowBusy}
                                  onClick={() => void handleComplete(b)}
                                >
                                  {isRowBusy ? 'Đang xử lý...' : '✓ Kết thúc & Hoàn thành'}
                                </button>
                              )}
                              {b.allowedActions.includes('NO_SHOW_CANCEL') && (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  disabled={isRowBusy}
                                  onClick={() => setNoShowTarget(b)}
                                >
                                  Hủy đơn & Mở sân
                                </button>
                              )}
                              {b.allowedActions.includes('CANCEL') && (
                                <button
                                  type="button"
                                  className="btn btn-danger-o btn-xs"
                                  style={{ fontWeight: 600 }}
                                  disabled={isRowBusy}
                                  onClick={() => openCancelModal(b)}
                                >
                                  Hủy lịch
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-outline btn-xs"
                                onClick={() => setDetailCode(b.bookingCode)}
                              >
                                Chi tiết
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {meta && meta.totalPages > 1 && (
              <div className="row between wrap g12">
                <span className="t12 c-s600">
                  Trang {meta.page} / {meta.totalPages} ({meta.totalItems} đơn)
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
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Sau →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {detailCode && (
        <BookingDetailModal bookingCode={detailCode} onClose={() => setDetailCode(null)} />
      )}

      {settleTarget && (
        <div
          className="modal-bg"
          onClick={() => {
            if (!settleBusy) {
              setSettleTarget(null);
              setSettleQr(null);
            }
          }}
        >
          <div
            className="modal"
            data-testid="settle-modal"
            style={{ maxWidth: 500 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between g12 head-rule">
              <div className="col g2">
                <span className="eyebrow">Khách đến nhận sân</span>
                <h3 className="t18 w800 c-ink">Thu tất toán & Bàn giao sân</h3>
              </div>
              <span className="badge sq b-gray mono">#{settleTarget.bookingCode}</span>
            </div>

            <div className="hint col g6">
              <div className="row between g12">
                <span className="c-s600">Khách hàng:</span>
                <b className="c-ink">
                  {settleTarget.customerName} ({settleTarget.customerPhone})
                </b>
              </div>
              <div className="row between g12">
                <span className="c-s600">Sân & Khung giờ:</span>
                <b className="c-ink">
                  {settleTarget.courtName} ({settleTarget.startTime} - {settleTarget.endTime})
                </b>
              </div>
              <div className="row between g12">
                <span className="c-s600">Tổng tiền đơn:</span>
                <b className="c-ink">{vnd(settleTarget.totalAmount)}</b>
              </div>
              <div className="row between g12">
                <span className="c-brand8">Đã thanh toán trước:</span>
                <b className="c-brand8">{vnd(settleTarget.paidAmount)}</b>
              </div>
              <div className="row between g12 top-rule" style={{ paddingTop: 6 }}>
                <b className="t14 c-rose">Cần thu thêm tại quầy:</b>
                <b className="t14 c-rose">{vnd(settleTarget.remainingAmount)}</b>
              </div>
            </div>

            <label
              className="row g8 hint"
              style={{ padding: 10, cursor: 'pointer', background: 'var(--s50)' }}
            >
              <input
                type="checkbox"
                checked={settleCheckIn}
                onChange={(e) => setSettleCheckIn(e.target.checked)}
              />
              <span className="t12 w700 c-ink">Nhận sân (bàn giao sân) ngay sau khi thu đủ tiền</span>
            </label>

            <div className="col g8">
              <label className="label" style={{ margin: 0 }}>Hình thức thu phần còn lại</label>
              <div className="row g8">
                {([
                  ['CASH', '💵 Tiền mặt'],
                  ['BANK_TRANSFER', '📱 Quét QR'],
                ] as const).map(([k, label]) => (
                  <label
                    key={k}
                    className={`radio-card f1${settleMethod === k ? ' on' : ''}`}
                    style={{ fontWeight: 700 }}
                  >
                    <input
                      type="radio"
                      name="settle-method"
                      checked={settleMethod === k}
                      disabled={settleBusy}
                      onChange={() => void handleSelectSettleMethod(k)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {settleMethod === 'BANK_TRANSFER' && (
              <div className="col g8">
                {settleQr ? (
                  <>
                    <VietQrBox
                      variant="compact"
                      qrPayload={settleQr.qrPayload}
                      bankName={settleQr.bank.bankName}
                      bankAccountNo={settleQr.bank.accountNo}
                      bankAccountName={settleQr.bank.accountName}
                      amount={settleQr.amount}
                      transferContent={settleQr.transferContent}
                      imgTestId="settle-qr-image"
                      amountTestId="settle-qr-amount"
                    />
                    <div className="row between wrap g8 t11">
                      <span className="c-s600">
                        Hiệu lực mã QR:{' '}
                        <b className="mono">
                          {formatCountdown(Math.max(0, Date.parse(settleQr.expiresAt) - nowMs))}
                        </b>
                      </span>
                      <span className="c-amber w700">Chờ xác nhận từ ngân hàng</span>
                    </div>
                  </>
                ) : (
                  <div className="hint" style={{ textAlign: 'center', padding: 16 }}>
                    Đang tạo mã VietQR tất toán...
                  </div>
                )}
              </div>
            )}

            <div className="row g8 wrap" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={settleBusy}
                onClick={() => {
                  setSettleTarget(null);
                  setSettleQr(null);
                }}
              >
                Đóng
              </button>
              {settleMethod === 'CASH' ? (
                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  disabled={settleBusy}
                  onClick={() => void handleConfirmCashSettle()}
                >
                  {settleBusy
                    ? 'Đang xử lý...'
                    : `✓ Đã thu đủ ${vnd(settleTarget.remainingAmount)}`}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-outline btn-md"
                    disabled={settleBusy}
                    onClick={() => void handleRegenerateSettleQr()}
                  >
                    Tạo lại mã QR
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-md"
                    disabled={settleBusy || !settleQr}
                    onClick={() => void handleRecheckSettleQr()}
                  >
                    {settleBusy ? 'Đang kiểm tra...' : 'Kiểm tra lại giao dịch'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {cancelTarget && (
        <div className="modal-bg" onClick={() => !cancelBusy && setCancelTarget(null)}>
          <div
            className="modal"
            data-testid="pos-cancel-modal"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between g12 head-rule">
              <h3 className="t18 w800 c-ink">Hủy đơn #{cancelTarget.bookingCode}?</h3>
              <span className="badge sq b-rose-soft mono">#{cancelTarget.bookingCode}</span>
            </div>

            {cancelPreviewQ.isLoading ? (
              <div className="hint" style={{ textAlign: 'center', padding: 16 }}>
                Đang tính toán chính sách hoàn hủy...
              </div>
            ) : cancelPreviewQ.isError ? (
              <div className="field-err">
                {extractErrorMessage(cancelPreviewQ.error, 'Không thể tải thông tin hoàn hủy.')}
              </div>
            ) : cancelPreviewQ.data ? (
              <div
                className="hint col g4"
                style={{
                  background: 'var(--rose-50)',
                  borderColor: 'var(--rose-300)',
                  color: 'var(--rose-950)',
                }}
              >
                {cancelPreviewQ.data.paidAmount > 0 ? (
                  <>
                    <span>
                      Khách đã thanh toán <b>{vnd(cancelPreviewQ.data.paidAmount)}</b> (tiền cọc{' '}
                      <b>{vnd(cancelPreviewQ.data.depositKept)}</b> luôn được giữ lại).
                    </span>
                    <span>
                      Tỷ lệ hoàn phần ngoài cọc: <b>{cancelPreviewQ.data.refundRate}%</b> → hoàn{' '}
                      <b>{vnd(cancelPreviewQ.data.refundAmount)}</b>, giữ lại{' '}
                      <b>{vnd(cancelPreviewQ.data.retainedAmount)}</b>.
                    </span>
                  </>
                ) : (
                  <span>
                    Đơn chưa phát sinh thanh toán. Khi hủy, khung giờ sẽ được mở trống lại.
                  </span>
                )}
                {cancelPreviewQ.data.policyText && (
                  <span className="t11">{cancelPreviewQ.data.policyText}</span>
                )}
              </div>
            ) : null}

            <div className="col g8">
              <label className="label" style={{ margin: 0 }}>Lý do hủy đơn</label>
              <select
                className="select sm"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                className="input sm"
                placeholder={
                  cancelReason === 'Lý do khác'
                    ? 'Nhập lý do hủy cụ thể (bắt buộc)...'
                    : 'Ghi chú thêm (không bắt buộc)'
                }
                maxLength={255}
                value={cancelCustomReason}
                onChange={(e) => setCancelCustomReason(e.target.value)}
              />
            </div>

            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={cancelBusy}
                onClick={() => setCancelTarget(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-danger btn-md"
                disabled={cancelBusy || (cancelPreviewQ.data ? !cancelPreviewQ.data.canCancel : false)}
                onClick={() => void handleConfirmCancel()}
              >
                {cancelBusy ? 'Đang hủy...' : 'Xác nhận hủy đơn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {noShowTarget && (
        <div className="modal-bg" onClick={() => !noShowBusy && setNoShowTarget(null)}>
          <div
            className="modal"
            data-testid="no-show-confirm-modal"
            style={{ maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="t18 w800 c-ink">
              Xác nhận hủy đơn quá giờ #{noShowTarget.bookingCode}?
            </h3>
            <div
              className="hint col g4"
              style={{
                background: 'var(--rose-50)',
                borderColor: 'var(--rose-300)',
                color: 'var(--rose-950)',
              }}
            >
              <span>
                Đơn của khách <b>{noShowTarget.customerName}</b> ({noShowTarget.customerPhone}) đã quá giờ nhận sân.
              </span>
              <span>
                Hủy phân loại <b>Khách không đến nhận sân (NO_SHOW)</b> sẽ giữ lại toàn bộ tiền đã thu (
                <b>{vnd(noShowTarget.paidAmount)}</b>) và mở trống lại sân {noShowTarget.courtName}.
              </span>
            </div>
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={noShowBusy}
                onClick={() => setNoShowTarget(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-danger btn-md"
                disabled={noShowBusy}
                onClick={() => void handleConfirmNoShow()}
              >
                {noShowBusy ? 'Đang xử lý...' : 'Xác nhận hủy & Mở sân'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
