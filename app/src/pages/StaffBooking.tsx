import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import type {
  BookingSummaryDto,
  PaymentMethod,
  PaymentOption,
  PaymentRequestDto,
  ReceiptDto,
} from '@sporthub/shared';
import { availabilityKeys } from '../api/availability.ts';
import { bookingsKeys } from '../api/bookings.ts';
import { useSports } from '../api/catalog.ts';
import { getServerNowMs } from '../api/client.ts';
import { dashboardKeys } from '../api/dashboard.ts';
import {
  createPaymentRequestApi,
  recheckPaymentRequestApi,
} from '../api/payments.ts';
import {
  abortPosBookingApi,
  collectPosCashApi,
  createPosBookingApi,
  posKeys,
  lookupPosCustomerApi,
  useLatestReceipt,
  usePosPromotions,
  usePosSchedule,
  type PosCustomerDto,
  type PosScheduleCell,
  type PosScheduleCourt,
} from '../api/pos.ts';
import { useBookingQuote } from '../api/pricing.ts';
import { queryClient } from '../api/queryClient.ts';
import { getSocket, subscribeRoom, unsubscribeRoom } from '../api/socket.ts';
import { useAuth } from '../auth/authContext.ts';
import VietQrBox from '../components/VietQrBox.tsx';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import {
  extractErrorMessage,
  formatCountdown,
  formatDateTimeVn,
  formatDepositRule,
  kfmt,
  money,
  todayVn,
  vnd,
} from '../utils/format.ts';

interface SlotSelection {
  courtId: number;
  idxs: number[];
}

interface PendingCounterOrder {
  booking: BookingSummaryDto;
  paymentRequest: PaymentRequestDto;
}

const PHONE_REGEX = /^0\d{9}$/;

function toggleContiguousFreeSelection(
  current: SlotSelection | null,
  courtId: number,
  idx: number,
  cells: PosScheduleCell[],
): SlotSelection | null {
  const clicked = cells[idx];
  if (!clicked || clicked.state !== 'FREE') {
    return current;
  }

  if (!current || current.courtId !== courtId || current.idxs.length === 0) {
    return { courtId, idxs: [idx] };
  }

  const sorted = [...current.idxs].sort((a, b) => a - b);
  const minIdx = sorted[0];
  const maxIdx = sorted[sorted.length - 1];

  if (sorted.includes(idx)) {
    if (sorted.length === 1) {
      return null;
    }
    if (idx === minIdx) {
      return { courtId, idxs: sorted.slice(1) };
    }
    if (idx === maxIdx) {
      return { courtId, idxs: sorted.slice(0, -1) };
    }
    return { courtId, idxs: [idx] };
  }

  const nextMin = Math.min(minIdx, idx);
  const nextMax = Math.max(maxIdx, idx);
  const nextIdxs: number[] = [];
  for (let i = nextMin; i <= nextMax; i++) {
    if (cells[i]?.state !== 'FREE') {
      return { courtId, idxs: [idx] };
    }
    nextIdxs.push(i);
  }
  return { courtId, idxs: nextIdxs };
}

export default function StaffBooking() {
  const { activeBranchId } = useOutletContext<StaffOutlet>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const focusCourtId = Number(searchParams.get('courtId') || '0') || null;

  const today = todayVn();
  const [date, setDate] = useState(today);
  const [sportId, setSportId] = useState<'all' | number>('all');
  const [sel, setSel] = useState<SlotSelection | null>(null);

  const [customerType, setCustomerType] = useState<'GUEST' | 'MEMBER'>('GUEST');
  const [memberPhone, setMemberPhone] = useState('');
  const [foundMember, setFoundMember] = useState<PosCustomerDto | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [guestPhone, setGuestPhone] = useState('');
  const [guestName, setGuestName] = useState('');

  const [promoChoice, setPromoChoice] = useState<string | null>(null);
  const [paymentOption, setPaymentOption] = useState<PaymentOption>('FULL');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [qrActionBusy, setQrActionBusy] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<PendingCounterOrder | null>(null);
  const [recentReceipt, setRecentReceipt] = useState<ReceiptDto | null>(null);
  const [nowMs, setNowMs] = useState(() => getServerNowMs());

  const sportsQ = useSports({ branchId: activeBranchId ?? undefined });
  const scheduleQ = usePosSchedule({
    branchId: activeBranchId,
    date,
    sportId: sportId === 'all' ? undefined : sportId,
  });
  const latestReceiptQ = useLatestReceipt(activeBranchId);

  const schedule = scheduleQ.data;
  const sports = sportsQ.data ?? [];

  const activeCourt: PosScheduleCourt | null = useMemo(() => {
    if (!schedule || !sel) return null;
    return schedule.courts.find((c) => c.courtId === sel.courtId) ?? null;
  }, [schedule, sel]);

  const selectionRange = useMemo(() => {
    if (!activeCourt || !sel || sel.idxs.length === 0) return null;
    const sorted = [...sel.idxs].sort((a, b) => a - b);
    const cells = sorted.map((idx) => activeCourt.cells[idx]).filter(Boolean);
    if (
      cells.length !== sorted.length ||
      cells.some((cell) => cell.state !== 'FREE')
    ) {
      return null;
    }
    return {
      startTime: cells[0].start,
      endTime: cells[cells.length - 1].end,
      slotCount: cells.length,
    };
  }, [activeCourt, sel]);

  const validCustomerPhone = useMemo(() => {
    if (customerType === 'MEMBER') {
      const trimmed = foundMember?.phone ?? memberPhone.trim();
      return PHONE_REGEX.test(trimmed) ? trimmed : undefined;
    }
    const trimmed = guestPhone.trim();
    return PHONE_REGEX.test(trimmed) ? trimmed : undefined;
  }, [customerType, foundMember, memberPhone, guestPhone]);

  const promotionsQ = usePosPromotions(
    activeBranchId
      ? {
          branchId: activeBranchId,
          courtId: activeCourt?.courtId,
          date,
          startTime: selectionRange?.startTime,
          endTime: selectionRange?.endTime,
          customerPhone: validCustomerPhone,
        }
      : null,
    { enabled: Boolean(activeBranchId) },
  );

  const defaultPromoCode = promotionsQ.data?.defaultCode ?? '';
  const selectedPromoCode = promoChoice ?? defaultPromoCode;

  const quoteQ = useBookingQuote(
    activeCourt && selectionRange && !pendingOrder
      ? {
          courtId: activeCourt.courtId,
          date,
          startTime: selectionRange.startTime,
          endTime: selectionRange.endTime,
          promotionCode: selectedPromoCode || undefined,
          paymentOption,
          channel: 'COUNTER',
          customerPhone: validCustomerPhone,
        }
      : null,
    { enabled: Boolean(activeCourt && selectionRange && !pendingOrder) },
  );

  const quote = quoteQ.data ?? null;
  const fullPaymentRequired = quote?.deposit.fullPaymentRequired ?? false;
  const effectivePaymentOption: PaymentOption = fullPaymentRequired ? 'FULL' : paymentOption;

  const pendingBookingCode = pendingOrder?.booking.bookingCode ?? null;

  useEffect(() => {
    if (!pendingBookingCode) return;
    subscribeRoom({ channel: 'booking', bookingCode: pendingBookingCode });
    const socket = getSocket();

    const handleBookingEvent = (payload?: { bookingCode?: string; status?: string }) => {
      if (payload?.bookingCode !== pendingBookingCode) return;
      if (payload.status === 'CONFIRMED') {
        setPendingOrder(null);
        setSel(null);
        setCustomerType('GUEST');
        setMemberPhone('');
        setFoundMember(null);
        setLookupError(null);
        setGuestPhone('');
        setGuestName('');
        setPromoChoice(null);
        setPaymentOption('FULL');
        setPaymentMethod('CASH');
        setNote('');
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: posKeys.all }),
          queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
          queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
          queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
        ]);
        toast(`Đã xác nhận thanh toán VietQR cho đơn #${pendingBookingCode}.`, 'ok');
      } else if (payload.status === 'CANCELED' || payload.status === 'EXPIRED') {
        setPendingOrder(null);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: posKeys.all }),
          queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
          queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
          queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
        ]);
        toast(
          `Đơn #${pendingBookingCode} đã chuyển sang ${payload.status === 'EXPIRED' ? 'quá hạn giữ chỗ' : 'đã hủy'}.`,
          'info',
        );
      }
    };

    socket.on('booking.paid', handleBookingEvent);
    socket.on('booking.updated', handleBookingEvent);
    return () => {
      socket.off('booking.paid', handleBookingEvent);
      socket.off('booking.updated', handleBookingEvent);
      unsubscribeRoom({ channel: 'booking', bookingCode: pendingBookingCode });
    };
  }, [pendingBookingCode, toast]);

  useEffect(() => {
    if (!pendingOrder) return;
    const timer = window.setInterval(() => {
      setNowMs(getServerNowMs());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingOrder]);

  const invalidatePosQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: posKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
      queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
    ]);
  };

  const resetDraftForm = () => {
    setSel(null);
    setCustomerType('GUEST');
    setMemberPhone('');
    setFoundMember(null);
    setLookupError(null);
    setGuestPhone('');
    setGuestName('');
    setPromoChoice(null);
    setPaymentOption('FULL');
    setPaymentMethod('CASH');
    setNote('');
  };

  const handleLookupMember = async () => {
    const phone = memberPhone.trim();
    if (!PHONE_REGEX.test(phone)) {
      setFoundMember(null);
      setLookupError('Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).');
      return;
    }
    setLookingUp(true);
    setLookupError(null);
    try {
      const res = await lookupPosCustomerApi(phone);
      if (res.found && res.customer) {
        setFoundMember(res.customer);
        setLookupError(null);
      } else {
        setFoundMember(null);
        setLookupError('Không tìm thấy hội viên với số điện thoại này.');
      }
    } catch (err) {
      setFoundMember(null);
      setLookupError(extractErrorMessage(err));
    } finally {
      setLookingUp(false);
    }
  };

  const handleCreatePosBooking = async () => {
    if (!activeBranchId) {
      toast('Vui lòng chọn chi nhánh làm việc.', 'err');
      return;
    }
    if (!activeCourt || !selectionRange) {
      toast('Vui lòng chọn khung giờ trống trên bảng lịch.', 'err');
      return;
    }

    if (customerType === 'MEMBER') {
      if (!foundMember) {
        toast('Vui lòng tra cứu và chọn hội viên hợp lệ trước khi tạo đơn.', 'err');
        return;
      }
    } else {
      if (!PHONE_REGEX.test(guestPhone.trim())) {
        toast('Số điện thoại khách không hợp lệ (10 chữ số, bắt đầu bằng 0).', 'err');
        return;
      }
      if (guestName.trim().length < 2) {
        toast('Vui lòng nhập họ và tên khách (tối thiểu 2 ký tự).', 'err');
        return;
      }
    }

    if (!quote) {
      toast('Đang tính báo giá từ hệ thống, vui lòng đợi giây lát.', 'err');
      return;
    }

    setSubmitting(true);
    try {
      const isZeroTotal = quote.totalAmount === 0;
      const shouldCollectCashNow = paymentMethod === 'CASH' && !isZeroTotal;

      const res = await createPosBookingApi(
        {
          branchId: activeBranchId,
          courtId: activeCourt.courtId,
          date,
          startTime: selectionRange.startTime,
          endTime: selectionRange.endTime,
          customer:
            customerType === 'MEMBER' && foundMember
              ? {
                  type: 'MEMBER',
                  userId: foundMember.userId,
                  phone: foundMember.phone,
                  fullName: foundMember.fullName,
                }
              : {
                  type: 'GUEST',
                  phone: guestPhone.trim(),
                  fullName: guestName.trim(),
                },
          promotionCode: selectedPromoCode ? selectedPromoCode : null,
          paymentOption: effectivePaymentOption,
          payment: shouldCollectCashNow
            ? { method: 'CASH', amount: quote.amountDueNow }
            : null,
          note: note.trim() || null,
        },
        crypto.randomUUID(),
      );

      if (res.receipt) {
        setRecentReceipt(res.receipt);
      }

      if (paymentMethod === 'BANK_TRANSFER' && res.booking.status === 'PENDING_PAYMENT') {
        const paymentRequest = await createPaymentRequestApi(
          res.booking.bookingCode,
          { purpose: effectivePaymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL' },
          crypto.randomUUID(),
        );
        setPendingOrder({ booking: res.booking, paymentRequest });
        setNowMs(getServerNowMs());
        await invalidatePosQueries();
        toast(
          `Đã giữ chỗ đơn #${res.booking.bookingCode}. Vui lòng cho khách quét mã VietQR để hoàn tất.`,
          'info',
        );
      } else {
        await invalidatePosQueries();
        toast(
          isZeroTotal
            ? `Đã tạo đơn #${res.booking.bookingCode} thành công (0 VNĐ).`
            : `Đã thu ${vnd(res.booking.paidAmount)} & tạo đơn #${res.booking.bookingCode}.`,
          'ok',
        );
        resetDraftForm();
      }
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecheckQr = async () => {
    if (!pendingOrder) return;
    setQrActionBusy(true);
    try {
      const res = await recheckPaymentRequestApi(pendingOrder.paymentRequest.requestId);
      if (res.status === 'PAID' || res.booking?.status === 'CONFIRMED') {
        await invalidatePosQueries();
        toast(`Đã xác nhận thanh toán VietQR cho đơn #${pendingOrder.booking.bookingCode}.`, 'ok');
        setPendingOrder(null);
        resetDraftForm();
      } else {
        toast(res.message || 'Chưa ghi nhận giao dịch chuyển khoản.', 'info');
      }
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setQrActionBusy(false);
    }
  };

  const handleRegenerateQr = async () => {
    if (!pendingOrder) return;
    setQrActionBusy(true);
    try {
      const paymentRequest = await createPaymentRequestApi(
        pendingOrder.booking.bookingCode,
        { purpose: pendingOrder.paymentRequest.purpose },
        crypto.randomUUID(),
      );
      setPendingOrder({ ...pendingOrder, paymentRequest });
      setNowMs(getServerNowMs());
      toast('Đã tạo lại mã VietQR mới.', 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setQrActionBusy(false);
    }
  };

  const handleSwitchToCash = async () => {
    if (!pendingOrder) return;
    setQrActionBusy(true);
    try {
      const res = await collectPosCashApi(
        pendingOrder.booking.bookingCode,
        {
          method: 'CASH',
          amount: pendingOrder.booking.amountDueNow,
          version: pendingOrder.booking.version,
        },
        crypto.randomUUID(),
      );
      setRecentReceipt(res.receipt);
      await invalidatePosQueries();
      toast(`Đã thu tiền mặt ${vnd(res.receipt.amount)} cho đơn #${res.booking.bookingCode}.`, 'ok');
      setPendingOrder(null);
      resetDraftForm();
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setQrActionBusy(false);
    }
  };

  const handleAbortPendingOrder = async () => {
    if (!pendingOrder) return;
    setQrActionBusy(true);
    try {
      await abortPosBookingApi(pendingOrder.booking.bookingCode, {
        reason: 'Hủy tạo đơn tại quầy',
        version: pendingOrder.booking.version,
      });
      await invalidatePosQueries();
      toast(`Đã hủy tạo đơn #${pendingOrder.booking.bookingCode} và mở lại sân.`, 'info');
      setPendingOrder(null);
      resetDraftForm();
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setQrActionBusy(false);
    }
  };

  const displayedReceipt = recentReceipt ?? latestReceiptQ.data ?? null;
  const holidayText = schedule?.holiday
    ? schedule.holiday.reason ?? schedule.holiday.note ?? schedule.holiday.name ?? 'Ngày nghỉ lễ'
    : null;
  const courts = schedule?.courts ?? [];
  const slots = schedule?.slots ?? [];

  const renderCell = (court: PosScheduleCourt, cellIdx: number, span: number) => {
    const cell = court.cells[cellIdx];
    if (!cell) return <td key={cellIdx} colSpan={span} className="closed">—</td>;

    if (cell.state === 'LOCKED') {
      return (
        <td key={cellIdx} colSpan={span} className="locked" title={cell.reason || 'Bảo trì'}>
          🔒 {cell.blockType === 'DECOMMISSION' ? 'Ngừng' : 'Bảo trì'}
        </td>
      );
    }

    if (cell.state === 'PAST') {
      return (
        <td key={cellIdx} colSpan={span}>
          <div className="cell" style={{ opacity: 0.5, cursor: 'not-allowed', background: 'var(--s100)' }}>
            Đã qua
          </div>
        </td>
      );
    }

    if (cell.state === 'IN_USE') {
      return (
        <td key={cellIdx} colSpan={span}>
          <div className="cell play">
            Đang chơi
            <small>{cell.booking ? `#${cell.booking.bookingCode}` : ''}</small>
          </div>
        </td>
      );
    }

    if (cell.state === 'PENDING_PAYMENT') {
      return (
        <td key={cellIdx} colSpan={span}>
          <div className="cell hold">
            Chờ chuyển khoản
            <small>{cell.booking ? `#${cell.booking.bookingCode}` : ''}</small>
          </div>
        </td>
      );
    }

    if (cell.state === 'BOOKED') {
      const bk = cell.booking;
      const paidText =
        bk?.paymentStatus === 'PAID'
          ? 'Đã thu 100%'
          : bk && typeof bk.paidAmount === 'number'
            ? `Đã cọc ${kfmt(bk.paidAmount)}`
            : 'Đã đặt';
      return (
        <td key={cellIdx} colSpan={span}>
          <div className="cell hold">
            {paidText}
            <small>{bk?.isOverdue ? 'Quá giờ nhận sân' : bk ? `#${bk.bookingCode}` : ''}</small>
          </div>
        </td>
      );
    }

    const isSelected = sel?.courtId === court.courtId && sel.idxs.includes(cellIdx);
    return (
      <td key={cellIdx} colSpan={span}>
        <button
          type="button"
          className={`cell ${isSelected ? 'sel' : 'free'}`}
          disabled={Boolean(pendingOrder)}
          onClick={() =>
            setSel((cur) => toggleContiguousFreeSelection(cur, court.courtId, cellIdx, court.cells))
          }
        >
          {isSelected ? 'Đang chọn' : 'Còn trống'}
          <small>{typeof cell.price === 'number' ? money(cell.price) : '—'}</small>
        </button>
      </td>
    );
  };

  // R-16: mỗi sân có ô riêng theo bộ môn; header là lưới mịn nhất (slotMinutes) nên một ô chiếm nhiều cột.
  const renderCourtCells = (court: PosScheduleCourt) => {
    const gridMinutes = schedule?.slotMinutes ?? 0;
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    let usedColumns = 0;
    const tds = court.cells.map((cell, i) => {
      const span =
        gridMinutes > 0
          ? Math.max(1, Math.round((toMin(cell.end) - toMin(cell.start)) / gridMinutes))
          : 1;
      usedColumns += span;
      return renderCell(court, i, span);
    });
    const missing = slots.length - usedColumns;
    if (missing > 0) {
      tds.push(
        <td key="pad" colSpan={missing} className="closed">
          —
        </td>,
      );
    }
    return tds;
  };

  const qrRemainingMs = pendingOrder
    ? Math.max(0, Date.parse(pendingOrder.paymentRequest.expiresAt) - nowMs)
    : 0;

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g16 wrap">
          <div className="row g8">
            <span className="t12 w600 c-s600">Ngày đặt sân:</span>
            <input
              type="date"
              className="input sm"
              style={{ width: 'auto' }}
              value={date}
              min={today}
              disabled={Boolean(pendingOrder)}
              onChange={(e) => {
                setDate(e.target.value || today);
                setSel(null);
              }}
            />
          </div>
          <div className="row g8">
            <span className="t12 w600 c-s600">Bộ môn:</span>
            <select
              className="select sm fit"
              style={{ background: 'var(--s100)' }}
              value={sportId === 'all' ? 'all' : String(sportId)}
              disabled={Boolean(pendingOrder)}
              onChange={(e) => {
                const v = e.target.value;
                setSportId(v === 'all' ? 'all' : Number(v));
                setSel(null);
              }}
            >
              <option value="all">Tất cả bộ môn</option>
              {sports.map((s) => (
                <option key={s.sportId} value={s.sportId}>
                  {s.name} ({s.activeCourtCount} sân)
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row g16 wrap">
          <span className="legend"><i />Còn trống</span>
          <span className="legend"><i className="sel" />Đang chọn</span>
          <span className="legend"><i className="play" />Khách đang chơi</span>
          <span className="legend"><i className="hold" />Đã đặt / Giữ chỗ</span>
        </div>
      </section>

      <div className="grid12">
        <div className="span7 col g16">
          <section className="card card-lg col g16" style={{ padding: 20 }}>
            <div className="row between wrap g8">
              <h2 className="t14 w800 c-ink">Bảng lịch sân trực tiếp – Nhấp chọn ô trống để lập đơn</h2>
              <div className="row g8">
                {schedule?.branch && (
                  <span className="badge b-gray" style={{ fontSize: 11 }}>
                    {schedule.branch.isClosed
                      ? 'Chi nhánh đóng cửa'
                      : `Mở cửa: ${schedule.branch.openTime ?? '--:--'} – ${schedule.branch.closeTime ?? '--:--'}`}
                  </span>
                )}
                <span className="badge b-green-flat" style={{ fontSize: 11 }}>
                  Ca trực: {user?.fullName ?? 'Nhân viên'}
                </span>
              </div>
            </div>

            {holidayText && (
              <div
                className="hint"
                style={{
                  background: 'var(--amber-50)',
                  borderColor: 'var(--amber-300)',
                  color: 'var(--amber-900)',
                }}
              >
                📅 Ngày nghỉ lễ: {holidayText}
              </div>
            )}

            {scheduleQ.isLoading ? (
              <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
                Đang tải bảng lịch sân...
              </div>
            ) : scheduleQ.isError ? (
              <div className="field-err">
                {extractErrorMessage(scheduleQ.error, 'Không thể tải bảng lịch sân.')}
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="sched">
                  <thead>
                    <tr>
                      <th>Tên sân</th>
                      {slots.map((s) => (
                        <th key={s.start}>
                          {s.start} - {s.end}
                          <small className={s.isPeak ? 'peak' : ''}>{s.priceLabel ?? ''}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {slots.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="closed" style={{ padding: 24 }}>
                          Chi nhánh đóng cửa / nghỉ lễ trong ngày này.
                        </td>
                      </tr>
                    ) : courts.length === 0 ? (
                      <tr>
                        <td colSpan={slots.length + 1} className="closed" style={{ padding: 24 }}>
                          Không có sân hoạt động cho bộ lọc đã chọn.
                        </td>
                      </tr>
                    ) : (
                      courts.map((c) => (
                        <tr
                          key={c.courtId}
                          className={focusCourtId === c.courtId ? 'hl' : undefined}
                        >
                          <td>
                            <div className="t12 w800 c-ink">{c.name}</div>
                            <div className="t11 c-s600">
                              {typeof c.minPricePerHour === 'number' && typeof c.maxPricePerHour === 'number'
                                ? c.minPricePerHour === c.maxPricePerHour
                                  ? `${kfmt(c.minPricePerHour)}/h`
                                  : `${kfmt(c.minPricePerHour)} - ${kfmt(c.maxPricePerHour)}/h`
                                : c.code}
                            </div>
                          </td>
                          {renderCourtCells(c)}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {displayedReceipt && (
              <div
                className="col g6"
                style={{
                  background: 'var(--brand-50)',
                  border: '1px solid var(--brand-300)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div className="row between wrap g8">
                  <b className="t12 c-brand9">🧾 Phiếu thu gần nhất tại quầy</b>
                  <span
                    className="badge c-white"
                    style={{ background: 'var(--brand-700)', borderRadius: 4, fontSize: 11 }}
                  >
                    Đã thu tiền & Giữ lịch
                  </span>
                </div>
                <div className="row g24 wrap t12">
                  <span>
                    Mã phiếu: <b className="mono">{displayedReceipt.paymentCode}</b>
                  </span>
                  <span>
                    Mã đơn: <b className="mono">#{displayedReceipt.bookingCode}</b>
                  </span>
                  <span>
                    Thực thu:{' '}
                    <b>
                      {vnd(displayedReceipt.amount)} (
                      {displayedReceipt.method === 'CASH' ? 'Tiền mặt' : 'VietQR'})
                    </b>
                  </span>
                  <span>
                    Thu ngân: <b>{displayedReceipt.collectedByName ?? 'Hệ thống'}</b>
                  </span>
                  <span className="t11 c-s600">
                    {formatDateTimeVn(displayedReceipt.paidAt)}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
          <div className="row between head-rule g8">
            <div className="col g2">
              <span className="eyebrow">Phiếu đặt sân tại quầy</span>
              <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
                {pendingOrder ? `Chờ thanh toán QR #${pendingOrder.booking.bookingCode}` : 'Thông tin khách & Thu tiền'}
              </h2>
            </div>
            {pendingOrder ? (
              <span className="badge b-amber" style={{ fontSize: 11 }}>
                Chờ chuyển khoản
              </span>
            ) : activeCourt && selectionRange ? (
              <span className="badge b-green-flat" style={{ fontSize: 11 }}>
                {activeCourt.name} ({selectionRange.startTime} - {selectionRange.endTime})
              </span>
            ) : (
              <span className="badge b-gray-o" style={{ fontSize: 11 }}>
                Chưa chọn sân
              </span>
            )}
          </div>

          {pendingOrder ? (
            <div className="col g12">
              <div className="hint col g6">
                <div className="row between">
                  <span className="c-s600">Khách hàng:</span>
                  <b className="c-ink">
                    {pendingOrder.booking.customerName} ({pendingOrder.booking.customerPhone})
                  </b>
                </div>
                <div className="row between">
                  <span className="c-s600">Sân & Khung giờ:</span>
                  <b className="c-ink">
                    {pendingOrder.booking.courtName} ({pendingOrder.booking.startTime} - {pendingOrder.booking.endTime})
                  </b>
                </div>
                <div className="row between">
                  <span className="c-s600">Số tiền cần chuyển:</span>
                  <b className="c-brand8">{vnd(pendingOrder.booking.amountDueNow)}</b>
                </div>
              </div>

              <VietQrBox
                variant="compact"
                qrPayload={pendingOrder.paymentRequest.qrPayload}
                bankName={pendingOrder.paymentRequest.bank.bankName}
                bankAccountNo={pendingOrder.paymentRequest.bank.accountNo}
                bankAccountName={pendingOrder.paymentRequest.bank.accountName}
                amount={pendingOrder.paymentRequest.amount}
                transferContent={pendingOrder.paymentRequest.transferContent}
                imgTestId="pos-qr-image"
                amountTestId="pos-qr-amount"
                contentTestId="pos-qr-content"
              />

              <div className="row between wrap g8 t11">
                <span className="c-s600">
                  Mã QR còn hiệu lực:{' '}
                  <b className="mono">{formatCountdown(qrRemainingMs)}</b>
                </span>
                <span className="c-amber w700">Đang chờ báo có từ SePay</span>
              </div>

              <div className="col g8">
                <button
                  type="button"
                  className="btn btn-primary btn-md btn-block"
                  disabled={qrActionBusy}
                  onClick={() => void handleRecheckQr()}
                >
                  {qrActionBusy ? 'Đang kiểm tra...' : 'Kiểm tra lại giao dịch'}
                </button>
                <div className="row g8 wrap">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm f1"
                    disabled={qrActionBusy}
                    onClick={() => void handleSwitchToCash()}
                  >
                    Thu tiền mặt thay thế
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={qrActionBusy}
                    onClick={() => void handleRegenerateQr()}
                  >
                    Tạo lại mã QR
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-danger-o btn-sm btn-block"
                  disabled={qrActionBusy}
                  onClick={() => void handleAbortPendingOrder()}
                >
                  Hủy tạo đơn
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="col g8">
                <label className="label" style={{ margin: 0 }}>Loại khách hàng</label>
                <div className="row g8">
                  {([
                    ['GUEST', 'Khách vãng lai'],
                    ['MEMBER', 'Hội viên có tài khoản'],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`radio-card f1 center${customerType === k ? ' on' : ''}`}
                      onClick={() => {
                        setCustomerType(k);
                        setLookupError(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {customerType === 'MEMBER' ? (
                <div className="col g8">
                  <label className="label" style={{ margin: 0 }}>
                    Số điện thoại hội viên <span className="req">*</span>
                  </label>
                  <div className="row g8">
                    <input
                      className="input sm"
                      placeholder="09xxxxxxxx"
                      value={memberPhone}
                      onChange={(e) => {
                        setMemberPhone(e.target.value);
                        setFoundMember(null);
                        setLookupError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleLookupMember();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-dark btn-sm"
                      disabled={lookingUp}
                      onClick={() => void handleLookupMember()}
                    >
                      {lookingUp ? 'Đang tìm...' : 'Tra cứu'}
                    </button>
                  </div>
                  {foundMember && (
                    <div
                      className="hint hint-green col g2"
                      style={{ padding: 10 }}
                    >
                      <b className="c-brand8">
                        ✓ {foundMember.fullName} ({foundMember.code})
                      </b>
                      <span className="t11 c-s600">
                        SĐT: {foundMember.phone}
                        {foundMember.memberTier ? ` • Hạng: ${foundMember.memberTier}` : ''}
                      </span>
                    </div>
                  )}
                  {lookupError && <p className="field-err">{lookupError}</p>}
                </div>
              ) : (
                <div className="row g12" style={{ alignItems: 'flex-start' }}>
                  <div style={{ width: '48%' }}>
                    <label className="label">
                      Số điện thoại khách <span className="req">*</span>
                    </label>
                    <input
                      className="input sm"
                      placeholder="09xxxxxxxx"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                    />
                  </div>
                  <div className="f1">
                    <label className="label">
                      Họ và tên khách <span className="req">*</span>
                    </label>
                    <input
                      className="input sm"
                      placeholder="Nhập họ tên"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="top-rule col g8" style={{ paddingTop: 16 }}>
                <label className="label" style={{ margin: 0 }}>
                  Chương trình khuyến mãi / Mã giảm giá
                </label>
                <select
                  className="select sm"
                  value={selectedPromoCode}
                  onChange={(e) => setPromoChoice(e.target.value)}
                >
                  <option value="">Không áp dụng</option>
                  {(promotionsQ.data?.items ?? []).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} – {p.name}
                      {p.applicable && p.discountAmount > 0 ? ` (-${money(p.discountAmount)})` : ''}
                      {!p.applicable ? ' (Không thỏa điều kiện)' : ''}
                    </option>
                  ))}
                </select>
                {quote?.promotion && !quote.promotion.applied && quote.promotion.message && (
                  <p className="field-err">{quote.promotion.message}</p>
                )}
              </div>

              <div className="top-rule col g8" style={{ paddingTop: 16 }}>
                <label className="label" style={{ margin: 0 }}>Mức thanh toán</label>
                <div className="row g8">
                  {([
                    ['FULL', 'Thu đủ 100%'],
                    [
                      'DEPOSIT',
                      quote
                        ? `Thu cọc giữ sân (${formatDepositRule(quote.deposit.type, quote.deposit.value)})`
                        : 'Thu cọc giữ sân',
                    ],
                  ] as const).map(([k, label]) => (
                    <label
                      key={k}
                      className={`radio-card f1${effectivePaymentOption === k ? ' on' : ''}`}
                      style={{ opacity: k === 'DEPOSIT' && fullPaymentRequired ? 0.55 : 1 }}
                    >
                      <input
                        type="radio"
                        name="pos-pay-option"
                        checked={effectivePaymentOption === k}
                        disabled={k === 'DEPOSIT' && fullPaymentRequired}
                        onChange={() => setPaymentOption(k)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {effectivePaymentOption === 'DEPOSIT' && (
                  <p className="t11" style={{ color: 'var(--rose-800)' }}>
                    ⚠️ Tiền cọc không được hoàn lại nếu khách hủy đơn hoặc không đến nhận sân đúng giờ.
                  </p>
                )}
              </div>

              <div className="top-rule col g8" style={{ paddingTop: 16 }}>
                <label className="label" style={{ margin: 0 }}>Hình thức thu tiền tại quầy</label>
                <div className="row g8">
                  {([
                    ['CASH', '💵 Tiền mặt'],
                    ['BANK_TRANSFER', '📱 Quét mã VietQR'],
                  ] as const).map(([k, label]) => (
                    <label key={k} className={`radio-card f1${paymentMethod === k ? ' on' : ''}`}>
                      <input
                        type="radio"
                        name="pos-pay-method"
                        checked={paymentMethod === k}
                        onChange={() => setPaymentMethod(k)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="label" style={{ marginBottom: 4 }}>Ghi chú tại quầy (tùy chọn)</label>
                <input
                  className="input sm"
                  placeholder="Ghi chú đơn đặt sân..."
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="hint col g8" style={{ padding: 16 }}>
                {quoteQ.isLoading && activeCourt && selectionRange ? (
                  <span className="t12 c-s600">Đang tính giá từ máy chủ...</span>
                ) : quoteQ.isError ? (
                  <span className="field-err">
                    {extractErrorMessage(quoteQ.error, 'Không thể tính báo giá.')}
                  </span>
                ) : (
                  <>
                    {quote && quote.priceLines.length > 0 && (
                      <div className="col g4" style={{ paddingBottom: 6, borderBottom: '1px solid var(--s200)' }}>
                        {quote.priceLines.map((pl, idx) => (
                          <div key={`${pl.startTime}-${idx}`} className="row between t11 c-s600">
                            <span>
                              {pl.label} ({pl.startTime}–{pl.endTime} • {money(pl.pricePerHour)}/h)
                            </span>
                            <b>{vnd(pl.amount)}</b>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="row between">
                      <span className="c-s600">Tiền sân theo khung giờ:</span>
                      <b>{vnd(quote?.baseAmount ?? 0)}</b>
                    </div>
                    <div className="row between">
                      <span className="c-brand w600">Giảm giá khuyến mãi:</span>
                      <b className="c-brand">
                        {quote?.discountAmount ? `- ${vnd(quote.discountAmount)}` : '0 VNĐ'}
                      </b>
                    </div>
                    <div className="row between top-rule" style={{ paddingTop: 8 }}>
                      <b className="t14 c-brand9">Cần thu khách ngay:</b>
                      <b className="t16 c-brand8 w800">{vnd(quote?.amountDueNow ?? 0)}</b>
                    </div>
                    <div className="row between t11">
                      <span className="c-s600">Còn lại thu khi nhận sân:</span>
                      <span className="c-s700">{vnd(quote?.remainingOnArrival ?? 0)}</span>
                    </div>
                    {quote && (
                      <span className="t11 c-s500">
                        Thời lượng: {quote.durationMinutes / 60} giờ • {quote.court.branchName}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="row g8">
                <button
                  type="button"
                  className="btn btn-primary btn-lg f1"
                  disabled={submitting || !activeCourt || !selectionRange || !quote}
                  onClick={() => void handleCreatePosBooking()}
                >
                  {submitting
                    ? 'Đang tạo đơn...'
                    : paymentMethod === 'BANK_TRANSFER'
                      ? 'Tạo đơn & Hiện mã VietQR'
                      : '✓ Xác nhận thu tiền & Tạo đơn'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-lg"
                  disabled={submitting}
                  onClick={resetDraftForm}
                >
                  Làm mới
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
