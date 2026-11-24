import { useState } from 'react';
import {
  affectedKeys,
  closeAffectedBookingApi,
  reassignBookingApi,
  useAffectedBookings,
  useReassignOptions,
  type AffectedBookingItem,
} from '../api/affected.ts';
import { availabilityKeys } from '../api/availability.ts';
import { bookingsKeys } from '../api/bookings.ts';
import { dashboardKeys } from '../api/dashboard.ts';
import { posKeys } from '../api/pos.ts';
import { queryClient } from '../api/queryClient.ts';
import { useToast } from '../ui/toastContext.ts';
import { extractErrorMessage, todayVn, toVN, vnd } from '../utils/format.ts';

interface Props {
  branchId?: number | null;
  testId?: string;
  emptyText?: string;
  onChanged?: () => void;
}

/** Danh sách đơn bị ảnh hưởng & thao tác xử lý (API-36..39). */
export default function AffectedBookingsModal({
  branchId,
  testId = 'affected-warning-list',
  emptyText,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const listQ = useAffectedBookings({ branchId: branchId ?? undefined });
  const list = listQ.data ?? [];

  const [target, setTarget] = useState<{
    b: AffectedBookingItem;
    mode: 'reassign' | 'close';
  } | null>(null);
  const [date, setDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [courtId, setCourtId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const b = target?.b ?? null;
  const parsedTime = selectedTime.includes('-') ? selectedTime.split('-') : null;
  const optionsQ = useReassignOptions(
    b?.bookingCode,
    target?.mode === 'reassign'
      ? {
          date: date || undefined,
          startTime: parsedTime?.[0],
          endTime: parsedTime?.[1],
        }
      : undefined,
    { enabled: target?.mode === 'reassign' && Boolean(b) },
  );

  const openModal = (item: AffectedBookingItem, mode: 'reassign' | 'close') => {
    setTarget({ b: item, mode });
    setDate(item.date);
    setSelectedTime(`${item.startTime}-${item.endTime}`);
    setCourtId('');
    setNote('');
  };

  const timeOptions = optionsQ.data?.timeOptions ?? [];
  const candidateCourts = optionsQ.data?.courts ?? [];
  const chosenCourtId: number | null =
    typeof courtId === 'number' && candidateCourts.some((c) => c.courtId === courtId)
      ? courtId
      : (candidateCourts[0]?.courtId ?? null);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: affectedKeys.all }),
      queryClient.invalidateQueries({ queryKey: posKeys.all }),
      queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
    ]);
    onChanged?.();
  };

  const confirmReassign = async () => {
    if (!b || !chosenCourtId) {
      toast('Không có sân phù hợp để chuyển.', 'err');
      return;
    }
    const [st, en] = (selectedTime || `${b.startTime}-${b.endTime}`).split('-');
    if (!st || !en || !date) {
      toast('Vui lòng chọn ngày và khung giờ chuyển hợp lệ.', 'err');
      return;
    }
    setBusy(true);
    try {
      const res = await reassignBookingApi(b.bookingCode, {
        newCourtId: Number(chosenCourtId),
        date,
        startTime: st,
        endTime: en,
        note: note.trim() || undefined,
        version: b.version,
      });
      await invalidateAll();
      toast(
        `Đã chuyển đơn #${b.bookingCode} sang ${res.transfer.newCourtName}. Khách được thông báo, mã đơn & tiền giữ nguyên.`,
        'ok',
      );
      setTarget(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = async () => {
    if (!b) return;
    setBusy(true);
    try {
      const res = await closeAffectedBookingApi(b.bookingCode, {
        note: note.trim() || undefined,
        version: b.version,
      });
      await invalidateAll();
      toast(
        res.refund
          ? `Đã đóng đơn #${b.bookingCode} do cơ sở. Khoản hoàn trả ${vnd(res.refund.amount)} được đưa vào danh sách chờ hoàn tiền.`
          : `Đã đóng đơn #${b.bookingCode} do cơ sở.`,
        'ok',
      );
      setTarget(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const today = todayVn();

  return (
    <>
      <div className="col g8" data-testid={testId}>
        {listQ.isLoading && (
          <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
            Đang tải danh sách đơn bị ảnh hưởng...
          </div>
        )}
        {!listQ.isLoading && list.length === 0 && (
          <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
            {emptyText ?? 'Không có đơn nào bị ảnh hưởng.'}
          </div>
        )}
        {list.map((x) => (
          <div
            key={x.bookingCode}
            className="row between g12 wrap"
            style={{
              background: 'var(--amber-50)',
              border: '2px solid var(--amber-400)',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div className="col g2">
              <b className="t12 c-ink">
                <span className="mono">#{x.bookingCode}</span> • {x.customerName} ({x.customerPhone})
              </b>
              <span className="t12 c-s700">
                {x.courtName} • {toVN(x.date)} • {x.startTime} - {x.endTime} • Đã trả{' '}
                {vnd(x.paidAmount)}
              </span>
              <span className="t11 c-amber">
                {x.affectedReasons.map((r) => r.description).join(' • ') ||
                  'Đơn bị ảnh hưởng do cơ sở thay đổi lịch'}
              </span>
            </div>
            <div className="row g8">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid={`reassign-btn-${x.bookingCode}`}
                onClick={() => openModal(x, 'reassign')}
              >
                Chuyển sân / Đổi giờ
              </button>
              <button
                type="button"
                className="btn btn-danger-o btn-sm"
                data-testid={`close-btn-${x.bookingCode}`}
                onClick={() => openModal(x, 'close')}
              >
                Đóng đơn do cơ sở
              </button>
            </div>
          </div>
        ))}
      </div>

      {target && b && (
        <div className="modal-bg" onClick={() => !busy && setTarget(null)}>
          <div
            className="modal"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            {target.mode === 'reassign' ? (
              <>
                <h3 className="t18 w800 c-ink">Chuyển sân / Đổi giờ đơn #{b.bookingCode}</h3>
                <p className="t12 c-s600">
                  Giữ nguyên mã đơn và số tiền đã thanh toán ({vnd(b.paidAmount)}). Khách sẽ nhận
                  thông báo về lịch mới.
                </p>
                <div>
                  <label className="label">Ngày chơi mới</label>
                  <input
                    className="input sm"
                    type="date"
                    min={today}
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setCourtId('');
                    }}
                  />
                </div>
                <div>
                  <label className="label">Khung giờ (cùng thời lượng {b.durationMinutes} phút)</label>
                  <select
                    className="select sm"
                    value={selectedTime}
                    onChange={(e) => {
                      setSelectedTime(e.target.value);
                      setCourtId('');
                    }}
                  >
                    <option value={`${b.startTime}-${b.endTime}`}>
                      Giữ nguyên giờ ({b.startTime} - {b.endTime})
                    </option>
                    {timeOptions
                      .filter((t) => `${t.startTime}-${t.endTime}` !== `${b.startTime}-${b.endTime}`)
                      .map((t) => {
                        const key = `${t.startTime}-${t.endTime}`;
                        return (
                          <option key={key} value={key}>
                            {t.startTime} - {t.endTime}
                          </option>
                        );
                      })}
                  </select>
                </div>
                <div>
                  <label className="label">Sân thay thế (cùng chi nhánh & bộ môn)</label>
                  <select
                    data-testid="reassign-target-court"
                    className="select sm"
                    value={chosenCourtId === null ? '' : String(chosenCourtId)}
                    onChange={(e) =>
                      setCourtId(e.target.value ? Number(e.target.value) : '')
                    }
                    disabled={optionsQ.isLoading}
                  >
                    {candidateCourts.length === 0 && (
                      <option value="">
                        {optionsQ.isLoading
                          ? 'Đang tìm sân trống...'
                          : 'Không còn sân trống phù hợp'}
                      </option>
                    )}
                    {candidateCourts.map((c) => (
                      <option key={c.courtId} value={c.courtId}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Ghi chú chuyển sân (tùy chọn)</label>
                  <input
                    className="input sm"
                    placeholder="VD: Chuyển sang sân mái che tương đương"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-md"
                    disabled={busy}
                    onClick={() => setTarget(null)}
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-md"
                    disabled={!chosenCourtId || busy}
                    onClick={() => void confirmReassign()}
                  >
                    {busy ? 'Đang xử lý...' : 'Xác nhận chuyển'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="t18 w800 c-ink">Đóng đơn #{b.bookingCode} do cơ sở?</h3>
                <div
                  className="hint"
                  style={{
                    background: 'var(--rose-50)',
                    borderColor: 'var(--rose-300)',
                    color: 'var(--rose-950)',
                  }}
                >
                  Đơn sẽ chuyển sang <b>Đã hủy</b> (phân loại: do cơ sở). Toàn bộ khoản{' '}
                  <b>{vnd(b.paidAmount)}</b> đã thu (kể cả tiền cọc) được ghi nhận{' '}
                  <b>chờ hoàn tiền 100%</b> và <b>không tính vào doanh thu thực thu</b>.
                </div>
                <div>
                  <label className="label">Ghi chú gửi khách</label>
                  <input
                    className="input sm"
                    placeholder="VD: Sân ngừng khai thác để sửa chữa"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-md"
                    disabled={busy}
                    onClick={() => setTarget(null)}
                  >
                    Đóng
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-md"
                    disabled={busy}
                    onClick={() => void confirmClose()}
                  >
                    {busy ? 'Đang xử lý...' : 'Xác nhận đóng đơn'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
