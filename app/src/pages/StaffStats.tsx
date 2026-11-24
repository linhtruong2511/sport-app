import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import {
  BOOKING_STATUS_LABELS,
  type BookingSummaryDto,
} from '@sporthub/shared';
import { availabilityKeys } from '../api/availability.ts';
import { bookingsKeys } from '../api/bookings.ts';
import {
  dashboardKeys,
  useDailyDashboard,
  useDailyDashboardBookings,
  type DailyDashboardKpi,
  type DashboardCourtBoardItem,
} from '../api/dashboard.ts';
import { checkInPosBookingApi, posKeys } from '../api/pos.ts';
import { queryClient } from '../api/queryClient.ts';
import BookingDetailModal from '../components/BookingDetailModal.tsx';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import {
  extractErrorMessage,
  fmt,
  formatDateTimeVn,
  money,
  todayVn,
  toVN,
  vnd,
} from '../utils/format.ts';

const DRILL_TITLES: Record<DailyDashboardKpi, string> = {
  TOTAL: 'Tổng lượt đặt trong ngày',
  PLAYING: 'Các sân đang có khách chơi',
  PENDING: 'Đơn chờ thanh toán / tất toán',
  REVENUE: 'Các đơn cấu thành doanh thu thực thu',
};

export default function StaffStats() {
  const { branchFilter, branches } = useOutletContext<StaffOutlet>();
  const { toast } = useToast();
  const nav = useNavigate();

  const today = todayVn();
  const [date, setDate] = useState(today);
  const [drillKpi, setDrillKpi] = useState<DailyDashboardKpi | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const dashboardQ = useDailyDashboard({ branchId: branchFilter, date });
  const drillQ = useDailyDashboardBookings(
    drillKpi ? { branchId: branchFilter, date, kpi: drillKpi } : null,
    { enabled: Boolean(drillKpi) },
  );

  const branchLabel =
    branchFilter === 'all'
      ? 'toàn hệ thống'
      : (branches.find((b) => b.branchId === branchFilter)?.name ?? 'chi nhánh');

  const data = dashboardQ.data;
  const kpis = data?.kpis;
  const revenue = data?.revenue;
  const courtBoard = data?.courtBoard ?? [];
  const upcoming = data?.upcoming ?? [];

  const handleUpcomingAction = async (b: BookingSummaryDto) => {
    if (b.allowedActions.includes('CHECK_IN')) {
      setBusyCode(b.bookingCode);
      try {
        await checkInPosBookingApi(b.bookingCode, { version: b.version });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
          queryClient.invalidateQueries({ queryKey: posKeys.all }),
          queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
          queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
        ]);
        toast(`Đã giao ${b.courtName} cho khách (#${b.bookingCode}).`, 'ok');
      } catch (err) {
        toast(extractErrorMessage(err), 'err');
      } finally {
        setBusyCode(null);
      }
      return;
    }
    nav(`/staff/orders?bookingId=${encodeURIComponent(b.bookingCode)}`);
  };

  const renderCourtCard = (c: DashboardCourtBoardItem) => {
    const baseStyle = {
      borderRadius: 12,
      padding: 14,
      minHeight: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    } as const;

    if (c.status === 'LOCKED') {
      const isDecommission = c.block?.blockType === 'DECOMMISSION' || c.courtStatus === 'INACTIVE';
      return (
        <div
          key={c.courtId}
          style={{ ...baseStyle, background: 'var(--s200)', border: '1px solid var(--s300)' }}
        >
          <div className="col">
            <b className="t12 c-s800 w800">{c.name}</b>
            <b className="t12 c-s700">
              🔒 {isDecommission ? 'Ngừng khai thác' : 'Đang bảo trì / Tạm khóa'}
            </b>
            <span className="t11 c-s600">
              {c.block?.reason
                ? `${c.block.reason}${c.block.endAt ? ` • Đến ${formatDateTimeVn(c.block.endAt)}` : ''}`
                : 'Không thời hạn'}
            </span>
          </div>
          <span className="badge sq c-white" style={{ background: 'var(--s500)', fontSize: 10 }}>
            Tạm khóa
          </span>
        </div>
      );
    }

    if (c.status === 'IN_USE' && c.currentBooking) {
      return (
        <div
          key={c.courtId}
          style={{
            ...baseStyle,
            background: 'rgba(236,253,245,.7)',
            border: '2px solid var(--brand-500)',
          }}
        >
          <div className="col">
            <b className="t12 c-ink w800">{c.name}</b>
            <b className="t12 c-brand9">
              Đang sử dụng • #{c.currentBooking.bookingCode}
            </b>
            <span className="t11 c-s600">
              Khách: {c.currentBooking.customerName} • Hết giờ: {c.currentBooking.endTime}
            </span>
          </div>
          <span
            className="badge sq c-white"
            style={{ background: 'var(--brand-700)', fontSize: 10 }}
          >
            Đang chơi
          </span>
        </div>
      );
    }

    return (
      <div
        key={c.courtId}
        style={{ ...baseStyle, background: '#fff', border: '1px solid var(--s300)' }}
      >
        <div className="col">
          <b className="t12 c-ink w800">
            {c.name}
            {branchFilter === 'all' && c.branchName ? ` (${c.branchName})` : ''}
          </b>
          <b className="t12 c-brand">
            {c.status === 'UPCOMING' ? 'Sắp có lịch nhận sân' : 'Đang trống khung hiện tại'}
          </b>
          <span className="t11 c-s600">
            {c.nextBooking
              ? `Có lịch khách đặt lúc ${c.nextBooking.startTime} (#${c.nextBooking.bookingCode})`
              : 'Chưa có lịch tiếp theo hôm nay'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => nav(`/staff/booking?courtId=${c.courtId}`)}
        >
          Lập đơn
        </button>
      </div>
    );
  };

  return (
    <>
      <section className="card row between wrap g12" style={{ padding: 14 }}>
        <div className="row g12 wrap">
          <span className="t12 w700 c-s700">Ngày thống kê:</span>
          <input
            data-testid="stats-date-picker"
            type="date"
            className="input sm"
            style={{ width: 'auto' }}
            value={date}
            onChange={(e) => setDate(e.target.value || today)}
          />
        </div>
        <span className="t12 c-s600">
          Phạm vi: <b className="c-ink">{branchLabel}</b> • Ngày {toVN(date)}
        </span>
      </section>

      {dashboardQ.isError && (
        <div className="field-err">
          {extractErrorMessage(dashboardQ.error, 'Không thể tải dữ liệu thống kê trong ngày.')}
        </div>
      )}

      <div className="row g16 wrap" style={{ alignItems: 'stretch' }}>
        <StatCard
          id="kpi-total-bookings"
          onClick={() => setDrillKpi('TOTAL')}
          label="Tổng lượt đặt hôm nay"
          icon="📅"
          bg="var(--brand-100)"
          color="var(--s900)"
          value={kpis ? `${kpis.totalBookings} lượt đặt` : '—'}
          sub={
            kpis
              ? `${kpis.onlineBookings} đơn đặt online • ${kpis.counterBookings} đơn đặt tại quầy`
              : 'Đang tải...'
          }
        />
        <StatCard
          id="kpi-playing-courts"
          onClick={() => setDrillKpi('PLAYING')}
          label="Số sân đang có khách chơi"
          icon="🟢"
          bg="var(--brand-100)"
          color="var(--brand-800)"
          value={kpis ? `${kpis.playingCourts} / ${kpis.totalCourts} sân` : '—'}
          sub={
            kpis
              ? `${kpis.freeCourts} sân đang trống • ${kpis.maintenanceCourts} sân đang bảo trì`
              : 'Đang tải...'
          }
        />
        <StatCard
          id="kpi-pending-orders"
          onClick={() => setDrillKpi('PENDING')}
          label="Đơn chờ nhận sân / tất toán"
          icon="⏳"
          bg="var(--amber-100)"
          color="var(--amber-800)"
          value={
            kpis
              ? `${kpis.pendingCount ?? kpis.waitingPayment + kpis.waitingCheckin} đơn`
              : '—'
          }
          sub={
            kpis
              ? `${kpis.waitingPayment} đơn chờ chuyển khoản • ${kpis.waitingCheckin} đơn chờ nhận sân`
              : 'Đang tải...'
          }
        />
        <button
          type="button"
          data-testid="kpi-revenue"
          className="hero col g8 f1"
          style={{ padding: 20, borderRadius: 16, textAlign: 'left', cursor: 'pointer' }}
          onClick={() => setDrillKpi('REVENUE')}
        >
          <div className="row between">
            <span className="t12 w700" style={{ color: 'var(--brand-100)' }}>
              Doanh thu thực thu hôm nay
            </span>
            <span
              className="center t16 w800"
              style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--brand-600)' }}
            >
              ₫
            </span>
          </div>
          <div className="t24 w800">{revenue ? vnd(revenue.total) : '—'}</div>
          <p className="t12" style={{ color: 'var(--brand-100)' }}>
            {revenue
              ? `Chuyển khoản: ${money(revenue.bankTransfer)} • Tiền mặt: ${money(revenue.cash)}`
              : 'Đang tải...'}
          </p>
        </button>
      </div>

      <div className="grid12">
        <section className="span7 card col g16">
          <div className="row between wrap g8">
            <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
              Tình trạng hoạt động các sân tại {branchLabel}
            </h2>
            <Link to="/staff/booking" className="link-btn">
              + Đặt sân mới tại quầy →
            </Link>
          </div>

          {dashboardQ.isLoading ? (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Đang tải tình trạng các sân...
            </div>
          ) : courtBoard.length === 0 ? (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Chưa có sân nào trong phạm vi đã chọn.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {courtBoard.map(renderCourtCard)}
            </div>
          )}

          <div className="hint col g8" style={{ padding: 16 }}>
            <b className="c-ink">
              Chi tiết tiền thực thu trong ca ngày {toVN(date)} ({vnd(revenue?.total ?? 0)}):
            </b>
            <div className="row g12 wrap" style={{ paddingTop: 4 }}>
              {([
                ['Đơn đã thu đủ 100%:', revenue?.fullyPaidAmount ?? 0, 'c-ink'],
                ['Tiền cọc mới thu trong ngày:', revenue?.depositCollected ?? 0, 'c-brand'],
                ['Tiền cọc đơn hủy giữ lại:', revenue?.depositKept ?? 0, 'c-amber'],
              ] as const).map(([label, amount, cls]) => (
                <div
                  key={label}
                  className="f1 col"
                  style={{
                    background: '#fff',
                    border: '1px solid var(--s300)',
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <span className="c-s500">{label}</span>
                  <b className={`t14 w800 ${cls}`}>{fmt(amount)} VNĐ</b>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="span5 card col g16">
          <div className="row between head-rule">
            <div className="col">
              <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
                Lịch khách sắp đến nhận sân
              </h2>
              <p className="t12 c-s600">Các đơn sắp bắt đầu và đơn quá giờ chưa nhận sân</p>
            </div>
            <Link to="/staff/orders" className="link-btn">
              Xem toàn bộ →
            </Link>
          </div>
          <div className="col g12">
            {upcoming.length === 0 ? (
              <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
                Hiện không có đơn nào sắp đến giờ nhận sân.
              </div>
            ) : (
              upcoming.slice(0, 4).map((b) => {
                const late = b.isOverdue;
                const rem = b.remainingAmount;
                const tone = late
                  ? {
                      bg: 'var(--rose-50)',
                      bd: '2px solid var(--rose-300)',
                      chip: 'var(--rose-200)',
                      cc: 'var(--rose-950)',
                      text: 'Quá giờ nhận sân',
                    }
                  : rem > 0
                    ? {
                        bg: 'var(--amber-50)',
                        bd: '2px solid var(--amber-400)',
                        chip: 'var(--amber-200)',
                        cc: 'var(--amber-950)',
                        text: `Cần thu thêm ${money(rem)}`,
                      }
                    : {
                        bg: 'var(--s50)',
                        bd: '1px solid var(--s300)',
                        chip: 'var(--brand-100)',
                        cc: 'var(--brand-900)',
                        text: `Đã thanh toán đủ ${money(b.totalAmount)}`,
                      };

                const canDirectCheckIn = b.allowedActions.includes('CHECK_IN');
                return (
                  <div
                    key={b.bookingCode}
                    className="col g8"
                    style={{
                      background: tone.bg,
                      border: tone.bd,
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div className="row between g8">
                      <b className="t12 c-ink w800">
                        #{b.bookingCode} • {b.courtName}
                      </b>
                      <span
                        className="badge sq"
                        style={{ background: tone.chip, color: tone.cc, padding: '2px 10px' }}
                      >
                        {tone.text}
                      </span>
                    </div>
                    <p className="t12 c-s700">
                      Khách: <b>{b.customerName} ({b.customerPhone})</b>
                      {late ? (
                        <> • Đã thanh toán {money(b.paidAmount)} nhưng chưa đến nhận sân.</>
                      ) : (
                        <>
                          {' '}
                          • Giờ chơi: <b>{b.startTime} - {b.endTime}</b>
                        </>
                      )}
                    </p>
                    <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setDetailCode(b.bookingCode)}
                      >
                        Chi tiết
                      </button>
                      <button
                        type="button"
                        className={`btn ${late ? 'btn-danger' : 'btn-primary'} btn-sm`}
                        style={{ padding: '6px 14px' }}
                        disabled={busyCode === b.bookingCode}
                        onClick={() => void handleUpcomingAction(b)}
                      >
                        {busyCode === b.bookingCode
                          ? 'Đang xử lý...'
                          : late
                            ? 'Xử lý quá giờ'
                            : canDirectCheckIn
                              ? 'Giao sân ngay'
                              : rem > 0
                                ? 'Thu tiền & Giao sân'
                                : 'Mở xử lý'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {drillKpi && (
        <div className="modal-bg" onClick={() => setDrillKpi(null)}>
          <div
            className="modal"
            data-testid="kpi-drilldown-modal"
            style={{ maxWidth: 660, maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between g12">
              <h3 className="t18 w800 c-ink">{DRILL_TITLES[drillKpi]}</h3>
              <span className="badge b-gray">
                {drillQ.data ? `${drillQ.data.length} đơn` : '...'} • {toVN(date)}
              </span>
            </div>

            {drillQ.isLoading ? (
              <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
                Đang tải danh sách đơn...
              </div>
            ) : drillQ.isError ? (
              <div className="field-err">
                {extractErrorMessage(drillQ.error, 'Không thể tải danh sách chi tiết.')}
              </div>
            ) : (drillQ.data?.length ?? 0) === 0 ? (
              <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
                Không có đơn nào.
              </div>
            ) : (
              <div className="col g8">
                {drillQ.data!.map((b) => (
                  <div
                    key={b.bookingCode}
                    className="row between g12 wrap"
                    style={{ border: '1px solid var(--s300)', borderRadius: 10, padding: 10 }}
                  >
                    <div className="col">
                      <b className="t12 c-ink mono">#{b.bookingCode}</b>
                      <span className="t12 c-s700">
                        {b.customerName} • {b.courtName} • {b.startTime} - {b.endTime}
                      </span>
                    </div>
                    <div className="row g10">
                      <div className="col" style={{ alignItems: 'flex-end' }}>
                        <span className="badge b-gray">
                          {b.isOverdue ? 'Quá giờ nhận sân' : BOOKING_STATUS_LABELS[b.status]}
                        </span>
                        <span className="t11 c-s600">
                          {drillKpi === 'REVENUE'
                            ? `Thực giữ: ${vnd(b.retainedAmount ?? b.paidAmount)}`
                            : `Đã thu ${vnd(b.paidAmount)} / ${vnd(b.totalAmount)}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() => setDetailCode(b.bookingCode)}
                      >
                        Chi tiết
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                onClick={() => setDrillKpi(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-primary btn-md"
                onClick={() => nav('/staff/orders')}
              >
                Mở Quản lý đơn →
              </button>
            </div>
          </div>
        </div>
      )}

      {detailCode && (
        <BookingDetailModal bookingCode={detailCode} onClose={() => setDetailCode(null)} />
      )}
    </>
  );
}

function StatCard({
  id,
  onClick,
  label,
  icon,
  bg,
  color,
  value,
  sub,
}: {
  id: string;
  onClick: () => void;
  label: string;
  icon: string;
  bg: string;
  color: string;
  value: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      data-testid={id}
      onClick={onClick}
      className="card col g8 f1"
      style={{ textAlign: 'left', cursor: 'pointer' }}
    >
      <div className="row between">
        <span className="t12 w700 c-s600">{label}</span>
        <span
          className="center t16 w700"
          style={{ width: 36, height: 36, borderRadius: 12, background: bg, color }}
        >
          {icon}
        </span>
      </div>
      <div className="t24 w800" style={{ color }}>
        {value}
      </div>
      <p className="t12 c-s600">{sub}</p>
    </button>
  );
}
