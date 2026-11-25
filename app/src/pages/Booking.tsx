import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { PaymentOption } from '@sporthub/shared';
import {
  availabilityKeys,
  useAvailability,
  type AvailabilityCell,
  type AvailabilityCourt,
  type AvailabilityHolidayInfo,
} from '../api/availability.ts';
import { bookingsKeys, createBookingApi } from '../api/bookings.ts';
import { useBranches, useSports } from '../api/catalog.ts';
import { ApiError, getAccessToken } from '../api/client.ts';
import { pricingKeys, useBookingQuote, type QuoteRequest } from '../api/pricing.ts';
import { usePublicPromotions } from '../api/promotions.ts';
import { connectSocket, subscribeRoom, unsubscribeRoom } from '../api/socket.ts';
import { useAuth } from '../auth/authContext.ts';
import { useToast } from '../ui/toastContext.ts';
import {
  dow,
  extractErrorMessage,
  formatDepositRule,
  formatPromoSummary,
  mins,
  money,
  todayVn,
  toVN,
  vnd,
} from '../utils/format.ts';

interface SlotSelection {
  courtId: number;
  idxs: number[];
}

interface CellGroup {
  startIdx: number;
  span: number;
  cell: AvailabilityCell;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toggleContiguousSelection(
  cur: SlotSelection | null,
  courtId: number,
  idx: number,
): SlotSelection | null {
  if (!cur || cur.courtId !== courtId) {
    return { courtId, idxs: [idx] };
  }
  const lo = Math.min(...cur.idxs);
  const hi = Math.max(...cur.idxs);
  if (cur.idxs.includes(idx)) {
    if (cur.idxs.length === 1) return null;
    if (idx === lo || idx === hi) {
      return { courtId, idxs: cur.idxs.filter((x) => x !== idx) };
    }
    return { courtId, idxs: [idx] };
  }
  if (idx === lo - 1 || idx === hi + 1) {
    return { courtId, idxs: [...cur.idxs, idx].sort((a, b) => a - b) };
  }
  return { courtId, idxs: [idx] };
}

function groupLockedCells(cells: AvailabilityCell[]): CellGroup[] {
  const groups: CellGroup[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.state === 'LOCKED') {
      let span = 1;
      while (i + span < cells.length) {
        const next = cells[i + span];
        if (
          next.state === 'LOCKED' &&
          next.blockId === cell.blockId &&
          next.blockType === cell.blockType &&
          next.reason === cell.reason
        ) {
          span++;
        } else {
          break;
        }
      }
      groups.push({ startIdx: i, span, cell });
      i += span - 1;
    } else {
      groups.push({ startIdx: i, span: 1, cell });
    }
  }
  return groups;
}

function getHolidayNote(holiday: AvailabilityHolidayInfo | null | undefined): string | null {
  if (!holiday) return null;
  const record = holiday as AvailabilityHolidayInfo & { reason?: string | null };
  return record.reason || record.note || record.name || 'Ngày nghỉ lễ';
}

function formatDurationLabel(durationMinutes: number): string {
  const hours = durationMinutes / 60;
  return Number.isInteger(hours) ? `${hours} giờ` : `${hours.toFixed(1)} giờ`;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function isRetryableNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 0 || err.code === 'NETWORK_ERROR' || err.status >= 500;
  }
  return err instanceof TypeError;
}

export default function Booking() {
  const { user } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [sp] = useSearchParams();
  const queryClient = useQueryClient();

  const today = todayVn();
  const initialDateParam = sp.get('date');
  const initialDate = initialDateParam && ISO_DATE_RE.test(initialDateParam) ? initialDateParam : today;
  const initialPromo = (sp.get('promo') ?? '').trim().toUpperCase();

  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(() =>
    parsePositiveInt(sp.get('branchId')),
  );
  const [selectedSportId, setSelectedSportId] = useState<number | null>(() =>
    parsePositiveInt(sp.get('sportId')),
  );
  const [date, setDate] = useState<string>(initialDate);
  const [sel, setSel] = useState<SlotSelection | null>(null);
  const [promoInput, setPromoInput] = useState<string>(initialPromo);
  const [appliedPromo, setAppliedPromo] = useState<string | null>(initialPromo || null);
  const [payMode, setPayMode] = useState<PaymentOption>('FULL');
  const [submitErr, setSubmitErr] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const idempotencyKeyRef = useRef<string | null>(null);

  const branchesQ = useBranches({ status: 'ACTIVE' });
  const branches = useMemo(() => branchesQ.data ?? [], [branchesQ.data]);

  const effectiveBranchId = useMemo(() => {
    if (branches.length === 0) return selectedBranchId;
    if (selectedBranchId && branches.some((b) => b.branchId === selectedBranchId)) {
      return selectedBranchId;
    }
    return branches[0].branchId;
  }, [branches, selectedBranchId]);

  const sportsQ = useSports(
    effectiveBranchId ? { branchId: effectiveBranchId } : undefined,
    { enabled: effectiveBranchId !== null },
  );
  const allSports = useMemo(() => sportsQ.data ?? [], [sportsQ.data]);
  const sportsHere = useMemo(() => {
    const active = allSports.filter((s) => s.activeCourtCount > 0);
    return active.length > 0 ? active : allSports;
  }, [allSports]);

  const effectiveSportId = useMemo(() => {
    if (sportsHere.length === 0) return selectedSportId;
    if (selectedSportId && sportsHere.some((s) => s.sportId === selectedSportId)) {
      return selectedSportId;
    }
    return sportsHere[0].sportId;
  }, [sportsHere, selectedSportId]);

  const activeBranch = branches.find((b) => b.branchId === effectiveBranchId) ?? null;
  const activeSport = sportsHere.find((s) => s.sportId === effectiveSportId) ?? null;

  const availabilityQ = useAvailability({
    branchId: effectiveBranchId,
    sportId: effectiveSportId,
    date,
  });
  const availability = availabilityQ.data;

  const publicPromosQ = usePublicPromotions(
    {
      branchId: effectiveBranchId ?? undefined,
      sportId: effectiveSportId ?? undefined,
      limit: 6,
    },
    { enabled: effectiveBranchId !== null && effectiveSportId !== null },
  );
  const publicPromos = publicPromosQ.data ?? [];

  // Subscribe Socket.IO availability room cleanly
  useEffect(() => {
    if (!effectiveBranchId || !date) return;

    const s = connectSocket(getAccessToken());
    const payload = { channel: 'availability' as const, branchId: effectiveBranchId, date };

    const handleConnect = () => {
      subscribeRoom(payload);
      void queryClient.invalidateQueries({
        queryKey: availabilityKeys.grid({
          branchId: effectiveBranchId,
          sportId: effectiveSportId ?? undefined,
          date,
        }),
      });
    };

    const handleSlotUpdated = () => {
      void queryClient.invalidateQueries({
        queryKey: availabilityKeys.grid({
          branchId: effectiveBranchId,
          sportId: effectiveSportId ?? undefined,
          date,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: pricingKeys.all });
    };

    if (s.connected) {
      subscribeRoom(payload);
    }
    s.on('connect', handleConnect);
    s.on('slot.updated', handleSlotUpdated);

    return () => {
      s.off('connect', handleConnect);
      s.off('slot.updated', handleSlotUpdated);
      unsubscribeRoom(payload);
    };
  }, [effectiveBranchId, effectiveSportId, date, queryClient]);

  // Derive whether selected cells are still FREE in the latest availability grid
  const selectedCourt: AvailabilityCourt | null = useMemo(() => {
    if (!sel || !availability) return null;
    return availability.courts.find((c) => c.courtId === sel.courtId) ?? null;
  }, [sel, availability]);

  const selectionStillFree = useMemo(() => {
    if (!sel || !selectedCourt || sel.idxs.length === 0) return false;
    return sel.idxs.every((idx) => selectedCourt.cells[idx]?.state === 'FREE');
  }, [sel, selectedCourt]);

  const activeSelection = useMemo(() => {
    if (!sel || !selectedCourt || !selectionStillFree || !availability) return null;
    const sorted = [...sel.idxs].sort((a, b) => a - b);
    const firstCell = selectedCourt.cells[sorted[0]];
    const lastCell = selectedCourt.cells[sorted[sorted.length - 1]];
    if (!firstCell || !lastCell) return null;
    return {
      court: selectedCourt,
      startTime: firstCell.start,
      endTime: lastCell.end,
      durationMinutes: mins(lastCell.end) - mins(firstCell.start),
    };
  }, [sel, selectedCourt, selectionStillFree, availability]);

  const quoteBody: QuoteRequest | null = useMemo(() => {
    if (!activeSelection) return null;
    return {
      courtId: activeSelection.court.courtId,
      date,
      startTime: activeSelection.startTime,
      endTime: activeSelection.endTime,
      promotionCode: appliedPromo ?? undefined,
      paymentOption: payMode,
      channel: 'ONLINE',
    };
  }, [activeSelection, date, appliedPromo, payMode]);

  const quoteQ = useBookingQuote(quoteBody);
  const quote = quoteQ.data;

  // Reset idempotency key whenever booking inputs change
  useEffect(() => {
    idempotencyKeyRef.current = null;
  }, [effectiveBranchId, effectiveSportId, date, sel, appliedPromo, payMode]);

  // If quote says slot is no longer available, refresh grid so availability updates
  useEffect(() => {
    if (quote && !quote.slotAvailable && effectiveBranchId) {
      idempotencyKeyRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: availabilityKeys.grid({
          branchId: effectiveBranchId,
          sportId: effectiveSportId ?? undefined,
          date,
        }),
      });
    }
  }, [quote, effectiveBranchId, effectiveSportId, date, queryClient]);

  const handleBranchChange = (nextBranchId: number) => {
    setSelectedBranchId(nextBranchId);
    setSel(null);
    setSubmitErr('');
  };

  const handleSportChange = (nextSportId: number) => {
    setSelectedSportId(nextSportId);
    setSel(null);
    setSubmitErr('');
  };

  const handleDateChange = (nextDate: string) => {
    setDate(nextDate || today);
    setSel(null);
    setSubmitErr('');
  };

  const handleToggleCell = (courtId: number, idx: number) => {
    setSubmitErr('');
    setSel((cur) => toggleContiguousSelection(cur, courtId, idx));
  };

  const handleApplyPromo = (rawCode?: string) => {
    const code = (rawCode ?? promoInput).trim().toUpperCase();
    if (!code) {
      toast('Vui lòng nhập mã giảm giá.', 'err');
      return;
    }
    setPromoInput(code);
    setAppliedPromo(code);
    setSubmitErr('');
  };

  const handleClearPromo = () => {
    setPromoInput('');
    setAppliedPromo(null);
    setSubmitErr('');
  };

  const handleSubmit = async () => {
    if (!activeSelection || !quote || submitting) return;
    if (!user) {
      toast('Vui lòng đăng nhập để tiếp tục đặt sân.', 'info');
      nav('/login', { state: { from: loc.pathname + loc.search } });
      return;
    }

    const effectivePayOption: PaymentOption = quote.deposit.fullPaymentRequired
      ? 'FULL'
      : quote.paymentOption;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = generateIdempotencyKey();
    }

    setSubmitErr('');
    setSubmitting(true);
    try {
      const res = await createBookingApi(
        {
          courtId: activeSelection.court.courtId,
          date,
          startTime: activeSelection.startTime,
          endTime: activeSelection.endTime,
          paymentOption: effectivePayOption,
          promotionCode: quote.promotion?.applied ? quote.promotion.code : null,
        },
        idempotencyKeyRef.current,
      );

      idempotencyKeyRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
        queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
      ]);

      if (res.booking.status === 'PENDING_PAYMENT') {
        toast(`Đã giữ chỗ đơn #${res.booking.bookingCode}.`, 'ok');
        nav(`/payment/${res.booking.bookingCode}`);
      } else {
        toast(`Đặt sân thành công đơn #${res.booking.bookingCode}.`, 'ok');
        nav('/my-bookings');
      }
    } catch (err) {
      if (!isRetryableNetworkError(err)) {
        idempotencyKeyRef.current = null;
      }

      const message = extractErrorMessage(err, 'Không thể tạo đơn đặt sân, vui lòng thử lại.');
      setSubmitErr(message);
      toast(message, 'err');

      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') {
        setSel(null);
        await queryClient.invalidateQueries({
          queryKey: availabilityKeys.grid({
            branchId: effectiveBranchId ?? undefined,
            sportId: effectiveSportId ?? undefined,
            date,
          }),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const holidayNote = getHolidayNote(availability?.holiday);
  const past = date < today;
  const slots = availability?.slots ?? [];
  const courts = availability?.courts ?? [];
  // Ẩn các cột giờ mà mọi sân đều đã qua (trạng thái PAST do API trả về, FE chỉ lọc hiển thị).
  // Giữ nguyên chỉ số gốc của slot để chọn ô / báo giá không bị lệch.
  const visibleSlotIdxs = slots
    .map((_, i) => i)
    .filter((i) => courts.length === 0 || !courts.every((c) => c.cells[i]?.state === 'PAST'));
  const visibleSlotSet = new Set(visibleSlotIdxs);
  const allSlotsPast = slots.length > 0 && courts.length > 0 && visibleSlotIdxs.length === 0;
  const colSpanAll = Math.max(visibleSlotIdxs.length + 1, 2);
  const anyFree = courts.some((c) => c.cells.some((cell) => cell.state === 'FREE'));
  const displayBlockMinutes = activeSport?.displayBlockMinutes ?? availability?.slotMinutes ?? 60;

  const fullOnly = quote
    ? quote.deposit.fullPaymentRequired || quote.deposit.amount >= quote.totalAmount
    : false;
  const effectivePayMode: PaymentOption = fullOnly ? 'FULL' : payMode;

  return (
    <>
      <section className="card card-lg col g16" style={{ borderRadius: 16 }}>
        <div className="row between wrap g16">
          <div className="col g2">
            <h1 className="t20 w800 c-ink">Chọn khung giờ đặt sân trực tuyến</h1>
            <p className="t12 c-s600">
              Nhấp vào ô màu trắng (Còn trống) trên bảng lịch để chọn khung giờ (bước hiển thị{' '}
              {displayBlockMinutes} phút). Có thể chọn nhiều khung liền kề cùng một sân.
            </p>
          </div>
          <div className="row g12 wrap">
            <span className="legend">
              <i />
              Còn trống
            </span>
            <span className="legend">
              <i className="sel" />
              Đang chọn
            </span>
            <span className="legend">
              <i className="play" />
              Lịch của bạn
            </span>
            <span className="legend">
              <i className="hold" />
              Đang giữ chỗ
            </span>
            <span className="legend">
              <i className="busy" />
              Đã có người đặt
            </span>
            <span className="legend">
              <i className="lock" />
              Bảo trì / Đóng cửa
            </span>
          </div>
        </div>
        <div className="row g16 wrap" style={{ alignItems: 'flex-end' }}>
          <div className="f1">
            <label className="label" htmlFor="booking-branch">
              Chi nhánh
            </label>
            <select
              id="booking-branch"
              className="select"
              value={effectiveBranchId ?? ''}
              disabled={branchesQ.isLoading || branches.length === 0}
              onChange={(e) => handleBranchChange(Number(e.target.value))}
            >
              {branches.length === 0 ? (
                <option value="">Đang tải chi nhánh...</option>
              ) : (
                branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="f1">
            <label className="label" htmlFor="booking-sport">
              Bộ môn
            </label>
            <select
              id="booking-sport"
              className="select"
              value={effectiveSportId ?? ''}
              disabled={sportsQ.isLoading || sportsHere.length === 0}
              onChange={(e) => handleSportChange(Number(e.target.value))}
            >
              {sportsHere.length === 0 ? (
                <option value="">Đang tải bộ môn...</option>
              ) : (
                sportsHere.map((s) => (
                  <option key={s.sportId} value={s.sportId}>
                    {s.name} ({s.activeCourtCount} sân)
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="f1">
            <label className="label" htmlFor="booking-date">
              Ngày đặt lịch
            </label>
            <input
              id="booking-date"
              className="input"
              type="date"
              value={date}
              min={today}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </div>
          <div
            className="f1 hint hint-green col g2"
            style={{ borderColor: 'var(--brand-100)', background: 'var(--brand-50)' }}
          >
            <span className="w700 c-brand9">
              Đơn giá thuê sân {activeSport?.name ?? ''}:
            </span>
            <b className="c-brand8">{availability?.priceHint || '—'}</b>
          </div>
        </div>
      </section>

      <div className="grid12">
        <section className="span8 card card-lg col g16" style={{ minWidth: 0 }}>
          <div className="row between wrap g8">
            <h2 className="t16 w800 c-ink">
              Lịch sân {dow(date)}, {toVN(date)} –{' '}
              {(availability?.branch.name ?? activeBranch?.name ?? '').replace(' - ', ' ')}
            </h2>
            <span className="badge b-green-flat" style={{ fontSize: 11 }}>
              Giờ mở cửa:{' '}
              {!availability
                ? 'Đang tải...'
                : availability.branch.isClosed ||
                    !availability.branch.openTime ||
                    !availability.branch.closeTime
                  ? 'Đóng cửa'
                  : `${availability.branch.openTime} – ${availability.branch.closeTime}`}
            </span>
          </div>

          {holidayNote && (
            <div
              className="hint"
              style={{
                background: 'var(--amber-50)',
                borderColor: 'var(--amber-300)',
                color: 'var(--amber-900)',
              }}
            >
              📅 {toVN(date)} là ngày nghỉ: {holidayNote}. Hệ thống không nhận lịch trong ngày này.
            </div>
          )}
          {past && <div className="hint">Không thể đặt lịch cho ngày đã qua.</div>}
          {!availabilityQ.isLoading &&
            !availabilityQ.isError &&
            availability &&
            !holidayNote &&
            !availability.branch.isClosed &&
            !past &&
            courts.length > 0 &&
            slots.length > 0 &&
            !anyFree && (
              <div
                className="hint"
                style={{
                  background: 'var(--amber-50)',
                  borderColor: 'var(--amber-300)',
                  color: 'var(--amber-900)',
                }}
              >
                Không còn khung giờ trống, vui lòng chọn ngày hoặc sân khác.
              </div>
            )}

          {availabilityQ.isError && (
            <div
              className="hint row between g12"
              style={{
                background: 'var(--rose-50)',
                borderColor: 'var(--rose-300)',
                color: 'var(--rose-900)',
              }}
            >
              <span>
                {extractErrorMessage(availabilityQ.error, 'Không thể tải lịch trống.')}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void availabilityQ.refetch()}
              >
                Thử lại
              </button>
            </div>
          )}

          <div className="tbl-wrap">
            <table className="sched">
              <thead>
                <tr>
                  <th>Sân thi đấu</th>
                  {visibleSlotIdxs.map((i) => {
                    const slot = slots[i];
                    return (
                      <th key={slot.start}>
                        {slot.start} - {slot.end}
                        <small
                          className={
                            slot.priceLabel?.toLowerCase().includes('cao điểm')
                              ? 'peak'
                              : undefined
                          }
                        >
                          {slot.priceLabel ?? ''}
                        </small>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {availabilityQ.isLoading && (
                  <tr>
                    <td colSpan={colSpanAll} className="closed" style={{ padding: 24 }}>
                      Đang tải bảng lịch sân...
                    </td>
                  </tr>
                )}
                {!availabilityQ.isLoading && availability && courts.length === 0 && (
                  <tr>
                    <td colSpan={colSpanAll} className="closed" style={{ padding: 24 }}>
                      Chi nhánh chưa có sân cho bộ môn này.
                    </td>
                  </tr>
                )}
                {!availabilityQ.isLoading &&
                  availability &&
                  courts.length > 0 &&
                  slots.length === 0 && (
                    <tr>
                      <td colSpan={colSpanAll} className="closed" style={{ padding: 24 }}>
                        {holidayNote
                          ? `Chi nhánh nghỉ lễ (${holidayNote}) trong ngày này.`
                          : 'Chi nhánh đóng cửa trong ngày này.'}
                      </td>
                    </tr>
                  )}
                {!availabilityQ.isLoading && availability && allSlotsPast && (
                  <tr>
                    <td colSpan={colSpanAll} className="closed" style={{ padding: 24 }}>
                      Đã hết khung giờ trong ngày này. Vui lòng chọn ngày khác.
                    </td>
                  </tr>
                )}
                {!availabilityQ.isLoading &&
                  availability &&
                  slots.length > 0 &&
                  !allSlotsPast &&
                  courts.map((court) => {
                    const groups = groupLockedCells(court.cells);
                    const stateColor =
                      court.state === 'READY'
                        ? 'var(--brand-700)'
                        : court.state === 'MAINTENANCE'
                          ? 'var(--amber-800)'
                          : 'var(--rose-700)';
                    const stateLabel =
                      court.state === 'READY'
                        ? 'Sẵn sàng'
                        : court.state === 'MAINTENANCE'
                          ? 'Bảo trì'
                          : 'Ngừng khai thác';

                    return (
                      <tr key={court.courtId}>
                        <td>
                          <div className="t12 w800 c-ink">{court.name}</div>
                          <div className="t11 w600" style={{ color: stateColor }}>
                            ● {stateLabel}
                          </div>
                        </td>
                        {groups.map(({ startIdx, span, cell }) => {
                          if (!visibleSlotSet.has(startIdx) && cell.state !== 'LOCKED') {
                            return null;
                          }
                          if (cell.state === 'LOCKED') {
                            let visibleSpan = 0;
                            for (let k = startIdx; k < startIdx + span; k++) {
                              if (visibleSlotSet.has(k)) visibleSpan++;
                            }
                            if (visibleSpan === 0) return null;
                            return (
                              <td key={startIdx} colSpan={visibleSpan} className="locked">
                                🔒{' '}
                                {cell.blockType === 'DECOMMISSION'
                                  ? 'Ngừng khai thác sân'
                                  : `Tạm ngưng nhận lịch${cell.reason ? ` (${cell.reason})` : ''}`}
                              </td>
                            );
                          }
                          if (cell.state === 'MINE') {
                            return (
                              <td key={startIdx}>
                                <div className="cell play">{cell.label ?? 'Lịch của bạn'}</div>
                              </td>
                            );
                          }
                          if (cell.state === 'HELD') {
                            return (
                              <td key={startIdx}>
                                <div className="cell hold">{cell.label ?? 'Đang giữ chỗ'}</div>
                              </td>
                            );
                          }
                          if (cell.state === 'BOOKED') {
                            return (
                              <td key={startIdx}>
                                <div className="cell busy">{cell.label ?? 'Kín lịch'}</div>
                              </td>
                            );
                          }
                          if (cell.state === 'PAST') {
                            return (
                              <td key={startIdx}>
                                <div
                                  className="cell"
                                  style={{
                                    background: 'var(--s100)',
                                    color: 'var(--s400)',
                                    cursor: 'not-allowed',
                                  }}
                                >
                                  Đã qua
                                </div>
                              </td>
                            );
                          }

                          const isSelected =
                            sel?.courtId === court.courtId && sel.idxs.includes(startIdx);
                          const priceText =
                            typeof cell.price === 'number' ? money(cell.price) : '';

                          return (
                            <td key={startIdx}>
                              <button
                                type="button"
                                className={`cell ${isSelected ? 'sel' : 'free'}`}
                                onClick={() => handleToggleCell(court.courtId, startIdx)}
                              >
                                {isSelected ? 'Đang chọn' : 'Còn trống'}
                                {priceText && <small>{priceText}</small>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="hint row g4 wrap" style={{ borderRadius: 12 }}>
            💡 Sau khi nhấn <b>"Tiếp tục thanh toán"</b>, hệ thống sẽ giữ chỗ tạm thời khung giờ
            này để bạn hoàn tất chuyển khoản <b>QR</b>.
          </div>
        </section>

        <aside
          className="span4 card card-lg card-raise col g16"
          style={{ position: 'sticky', top: 80 }}
        >
          <div className="col g2 head-rule">
            <span className="eyebrow">Phiếu đặt sân</span>
            <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
              Thông tin lịch đã chọn
            </h2>
          </div>

          {!activeSelection ? (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Chưa chọn khung giờ. Nhấp vào một ô <b>Còn trống</b> trên bảng lịch để bắt đầu.
            </div>
          ) : (
            <>
              <div className="col g10 t12">
                <div className="row between">
                  <span className="c-s600">Chi nhánh:</span>
                  <b className="c-ink">
                    {quote?.court.branchName ??
                      availability?.branch.name ??
                      activeBranch?.name ??
                      '—'}
                  </b>
                </div>
                <div className="row between">
                  <span className="c-s600">Sân thi đấu:</span>
                  <b className="c-brand w800">
                    {quote?.court.name ?? activeSelection.court.name}
                  </b>
                </div>
                <div className="row between g12">
                  <span className="c-s600 nowrap">Thời gian thuê:</span>
                  <b className="c-ink" style={{ textAlign: 'right' }}>
                    {toVN(date)} • {activeSelection.startTime} - {activeSelection.endTime} (
                    {formatDurationLabel(
                      quote?.durationMinutes ?? activeSelection.durationMinutes,
                    )}
                    )
                  </b>
                </div>
              </div>

              {quote && quote.priceLines.length > 0 && (
                <div className="col g6 top-rule" style={{ paddingTop: 12 }}>
                  <span className="t11 w700 c-s600">Chi tiết đơn giá khung giờ</span>
                  {quote.priceLines.map((line) => (
                    <div
                      key={`${line.startTime}-${line.endTime}-${line.label}`}
                      className="row between t12"
                    >
                      <span className="c-s600">
                        {line.label} ({line.startTime}–{line.endTime} • {money(line.pricePerHour)}
                        /h)
                      </span>
                      <b className="c-ink">{vnd(line.amount)}</b>
                    </div>
                  ))}
                </div>
              )}

              <div className="col g8 top-rule" style={{ paddingTop: 16 }}>
                <label className="label" style={{ margin: 0 }} htmlFor="booking-promo">
                  Mã giảm giá / Ưu đãi hội viên
                </label>
                <div className="row g8">
                  <input
                    id="booking-promo"
                    className="input sm bold"
                    style={{ padding: '10px 14px', fontSize: 14 }}
                    value={promoInput}
                    placeholder="Nhập mã ưu đãi"
                    onChange={(e) => setPromoInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleApplyPromo();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-dark btn-md"
                    onClick={() => handleApplyPromo()}
                  >
                    Áp dụng
                  </button>
                </div>
                <div className="row g6 wrap">
                  {publicPromos.map((p) => (
                    <button
                      type="button"
                      key={p.code}
                      className={`badge ${appliedPromo === p.code ? 'b-green' : 'b-gray-o'}`}
                      style={{ fontSize: 11 }}
                      onClick={() => handleApplyPromo(p.code)}
                    >
                      {p.code} (-{formatPromoSummary(p.discountType, p.discountValue, p.maxDiscountAmount)})
                    </button>
                  ))}
                  {appliedPromo && (
                    <button
                      type="button"
                      className="badge b-gray-o"
                      style={{ fontWeight: 500, fontSize: 11 }}
                      onClick={handleClearPromo}
                    >
                      Bỏ chọn
                    </button>
                  )}
                </div>
                {quote?.promotion && (
                  <p className={quote.promotion.applied ? 'field-ok' : 'field-err'}>
                    {quote.promotion.message ??
                      (quote.promotion.applied
                        ? 'Áp dụng mã khuyến mãi thành công.'
                        : 'Mã khuyến mãi không hợp lệ.')}
                  </p>
                )}
              </div>

              {quoteQ.isLoading && (
                <div className="hint" style={{ textAlign: 'center' }}>
                  Đang tính báo giá từ hệ thống...
                </div>
              )}

              {quoteQ.isError && (
                <div
                  className="hint"
                  style={{
                    background: 'var(--rose-50)',
                    borderColor: 'var(--rose-300)',
                    color: 'var(--rose-900)',
                  }}
                >
                  {extractErrorMessage(quoteQ.error, 'Không thể lấy báo giá cho khung giờ này.')}
                </div>
              )}

              {quote && (
                <>
                  <div className="col g8 top-rule" style={{ paddingTop: 16 }}>
                    <label className="label" style={{ margin: 0 }}>
                      Phương thức giữ sân
                    </label>
                    <label
                      className={`radio-card${effectivePayMode === 'FULL' ? ' on' : ''}`}
                      style={{
                        alignItems: 'flex-start',
                        padding: effectivePayMode === 'FULL' ? 11 : 12,
                        borderRadius: 12,
                      }}
                    >
                      <input
                        type="radio"
                        name="paymode"
                        checked={effectivePayMode === 'FULL'}
                        onChange={() => setPayMode('FULL')}
                        style={{ marginTop: 3 }}
                      />
                      <div className="col g2 f1">
                        <div className="row between">
                          <span className="t12 w800 c-ink">Thanh toán đủ 100%</span>
                          <span className="t12 w800 c-ink">{vnd(quote.totalAmount)}</span>
                        </div>
                        <span className="t11 c-s600" style={{ fontWeight: 400, lineHeight: '15px' }}>
                          Tất toán toàn bộ đơn đặt sân, đến giờ vào sân chơi ngay.
                        </span>
                      </div>
                    </label>
                    <label
                      className={`radio-card${effectivePayMode === 'DEPOSIT' ? ' on' : ''}`}
                      style={{
                        alignItems: 'flex-start',
                        padding: effectivePayMode === 'DEPOSIT' ? 11 : 12,
                        borderRadius: 12,
                        opacity: fullOnly ? 0.55 : 1,
                      }}
                    >
                      <input
                        type="radio"
                        name="paymode"
                        checked={effectivePayMode === 'DEPOSIT'}
                        disabled={fullOnly}
                        onChange={() => setPayMode('DEPOSIT')}
                        style={{ marginTop: 3 }}
                      />
                      <div className="col g2 f1">
                        <div className="row between">
                          <span className="t12 w800 c-ink">
                            Đặt cọc giữ sân (
                            {formatDepositRule(quote.deposit.type, quote.deposit.value)})
                          </span>
                          <span className="t12 w800 c-ink">{vnd(quote.deposit.amount)}</span>
                        </div>
                        <span className="t11 c-s600" style={{ fontWeight: 400, lineHeight: '15px' }}>
                          {fullOnly
                            ? 'Sân này yêu cầu cọc 100% tiền thuê — vui lòng chọn Thanh toán đủ.'
                            : 'Thanh toán trước để giữ lịch. Phần còn lại thanh toán tại quầy khi đến nhận sân.'}
                        </span>
                      </div>
                    </label>
                    {effectivePayMode === 'DEPOSIT' && (
                      <div
                        className="hint"
                        style={{
                          background: 'var(--rose-50)',
                          borderColor: 'var(--rose-300)',
                          color: 'var(--rose-950)',
                          padding: 10,
                        }}
                      >
                        ⚠️ Tiền cọc không được hoàn lại nếu hủy đơn hoặc không đến nhận sân đúng
                        giờ.
                      </div>
                    )}
                  </div>

                  <div className="hint col g8" style={{ padding: 14 }}>
                    <div className="row between">
                      <span className="c-s600">Giá thuê sân gốc:</span>
                      <b>{vnd(quote.baseAmount)}</b>
                    </div>
                    <div className="row between">
                      <span className="c-s600">Ưu đãi giảm giá:</span>
                      <b className="c-brand">
                        {quote.discountAmount > 0 ? `- ${vnd(quote.discountAmount)}` : '0 VNĐ'}
                      </b>
                    </div>
                    <div className="row between top-rule" style={{ paddingTop: 8 }}>
                      <b className="c-ink">Tổng tiền sau giảm:</b>
                      <b className="c-ink">{vnd(quote.totalAmount)}</b>
                    </div>
                    <div className="row between">
                      <b className="c-brand t14">Cần thanh toán ngay:</b>
                      <b className="c-brand t16">{vnd(quote.amountDueNow)}</b>
                    </div>
                    <div className="row between t11">
                      <span className="c-s600">Thanh toán thêm khi nhận sân:</span>
                      <span className="c-s600">{vnd(quote.remainingOnArrival)}</span>
                    </div>
                  </div>
                </>
              )}

              {quote && !quote.slotAvailable && (
                <p className="field-err" role="alert">
                  Khung giờ vừa chọn đã có người đặt, vui lòng chọn khung giờ khác.
                </p>
              )}

              {submitErr && (
                <p className="field-err" role="alert">
                  {submitErr}
                </p>
              )}

              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={
                  !quote ||
                  !quote.slotAvailable ||
                  quoteQ.isLoading ||
                  quoteQ.isError ||
                  submitting
                }
                onClick={() => void handleSubmit()}
              >
                {submitting ? 'Đang giữ chỗ...' : 'Tiếp tục thanh toán QR →'}
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
