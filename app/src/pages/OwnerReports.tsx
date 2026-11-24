import { useState } from 'react';
import type { FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { AudienceType, DiscountType, PromotionNotifyStatus, PromotionStatus } from '@sporthub/shared';
import { useAdminCourts } from '../api/adminCourts.ts';
import {
  adminPromotionsKeys,
  createPromotion,
  deletePromotion,
  notifyPromotion,
  pausePromotion,
  resumePromotion,
  updatePromotion,
  useAdminPromotion,
  useAdminPromotions,
  type AdminPromotionItem,
} from '../api/adminPromotions.ts';
import { useSports } from '../api/catalog.ts';
import { ApiError } from '../api/client.ts';
import { queryClient } from '../api/queryClient.ts';
import { useRevenueReport, type RevenueReportRow } from '../api/reports.ts';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import {
  addDays,
  extractErrorMessage,
  fmt,
  formatPromoSummary,
  money,
  todayVn,
  toVN,
  vnd,
} from '../utils/format.ts';

type Tab = 'revenue' | 'promotions';

const FRAMES: [string, string | null, string | null][] = [
  ['Cả ngày (mọi khung giờ)', null, null],
  ['06:00 - 11:00', '06:00', '11:00'],
  ['10:00 - 15:00', '10:00', '15:00'],
  ['15:00 - 22:00', '15:00', '22:00'],
];

const PROMO_STATUS_META: Record<PromotionStatus, { cls: string; label: string }> = {
  ACTIVE: { cls: 'b-green-flat', label: 'Đang chạy' },
  PAUSED: { cls: 'b-amber', label: 'Tạm dừng' },
  DISCONTINUED: { cls: 'b-gray', label: 'Ngừng áp dụng' },
};

const NOTIFY_STATUS_LABELS: Record<PromotionNotifyStatus, string> = {
  NONE: 'Chưa gửi thông báo',
  PENDING: 'Đang chờ gửi thông báo',
  SENT: 'Đã gửi thông báo',
  FAILED: 'Gửi thông báo thất bại',
};

interface PromoFormState {
  name: string;
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: string;
  allBranches: boolean;
  branchIds: number[];
  allSports: boolean;
  sportIds: number[];
  frameIdx: number;
  customFrom: string;
  customTo: string;
  startDate: string;
  endDate: string;
  maxUses: number;
  audienceType: AudienceType;
  customerPhonesText: string;
  notifyCustomers: boolean;
}

function makeEmptyPromoForm(): PromoFormState {
  const today = todayVn();
  return {
    name: '',
    code: '',
    description: '',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: '',
    allBranches: true,
    branchIds: [],
    allSports: true,
    sportIds: [],
    frameIdx: 0,
    customFrom: '06:00',
    customTo: '11:00',
    startDate: today,
    endDate: addDays(today, 29),
    maxUses: 100,
    audienceType: 'ALL',
    customerPhonesText: '',
    notifyCustomers: true,
  };
}

function formatMillion(n: number): string {
  return `${(n / 1e6).toFixed(2).replace('.', ',').replace(/,?0+$/, '') || '0'}Tr`;
}

function extractCustomerNotFoundPhones(err: ApiError): string[] {
  if (err.code !== 'CUSTOMER_NOT_FOUND' || !err.details || Array.isArray(err.details)) {
    return [];
  }
  const phones = (err.details as { phones?: unknown }).phones;
  return Array.isArray(phones) ? phones.filter((p): p is string => typeof p === 'string') : [];
}

export default function OwnerReports() {
  const { branchFilter, branches } = useOutletContext<StaffOutlet>();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('revenue');

  // ===== Tab 1: Báo cáo doanh thu =====
  const [fromInput, setFromInput] = useState(() => addDays(todayVn(), -29));
  const [toInput, setToInput] = useState(() => todayVn());
  const [appliedRange, setAppliedRange] = useState(() => ({
    from: addDays(todayVn(), -29),
    to: todayVn(),
  }));
  const [courtIdFilter, setCourtIdFilter] = useState<number | 'all'>('all');

  const scopedBranchId = branchFilter === 'all' ? undefined : branchFilter;
  const courtsQ = useAdminCourts({ branchId: scopedBranchId });
  const courtOptions = courtsQ.data ?? [];
  const effectiveCourtId: number | 'all' =
    courtIdFilter !== 'all' && courtOptions.some((c) => c.courtId === courtIdFilter)
      ? courtIdFilter
      : 'all';

  const reportQ = useRevenueReport({
    from: appliedRange.from,
    to: appliedRange.to,
    branchId: branchFilter,
    courtId: effectiveCourtId,
  });

  const report = reportQ.data;
  const summary = report?.summary;
  const branchLabel =
    branchFilter === 'all'
      ? `Tất cả chi nhánh (${branches.length} cơ sở)`
      : (branches.find((b) => b.branchId === branchFilter)?.name ?? 'Chi nhánh');

  const applyFilter = () => {
    if (!fromInput || !toInput || toInput < fromInput) {
      toast('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.', 'err');
      return;
    }
    setAppliedRange({ from: fromInput, to: toInput });
    toast('Đã cập nhật báo cáo theo bộ lọc.');
  };

  // ===== Tab 2: Quản lý khuyến mãi =====
  const [promoStatusFilter, setPromoStatusFilter] = useState<'ALL' | PromotionStatus>('ALL');
  const [promoSearch, setPromoSearch] = useState('');
  const [promoModalOpen, setPromoModalOpen] = useState(false);
  const [editPromoId, setEditPromoId] = useState<number | null>(null);
  const [editPromoSnapshot, setEditPromoSnapshot] = useState<AdminPromotionItem | null>(null);
  const [promoFormDraft, setPromoFormDraft] = useState<PromoFormState | null>(null);
  const [promoErr, setPromoErr] = useState('');
  const [missingPhones, setMissingPhones] = useState<string[]>([]);
  const [promoSaving, setPromoSaving] = useState(false);
  const [busyPromoId, setBusyPromoId] = useState<number | null>(null);

  const sportsQ = useSports();
  const sports = sportsQ.data ?? [];
  const promotionsQ = useAdminPromotions({
    status: promoStatusFilter === 'ALL' ? undefined : promoStatusFilter,
    q: promoSearch.trim() || undefined,
  });
  const promoDetailQ = useAdminPromotion(editPromoId, {
    enabled: promoModalOpen && editPromoId !== null,
  });

  const promotions = promotionsQ.data ?? [];

  const promoFromItem = (
    item: AdminPromotionItem,
    customerPhonesText = '',
  ): PromoFormState => {
    const frameIdx = FRAMES.findIndex(
      ([, tf, tt]) => tf === item.timeFrom && tt === item.timeTo,
    );
    return {
      name: item.name,
      code: item.code,
      description: item.description ?? '',
      discountType: item.discountType,
      discountValue: item.discountValue,
      maxDiscountAmount: item.maxDiscountAmount ? String(item.maxDiscountAmount) : '',
      allBranches: item.allBranches,
      branchIds: item.branches.map((b) => b.branchId),
      allSports: item.allSports,
      sportIds: item.sports.map((s) => s.sportId),
      frameIdx: frameIdx >= 0 ? frameIdx : item.timeFrom && item.timeTo ? -1 : 0,
      customFrom: item.timeFrom ?? '06:00',
      customTo: item.timeTo ?? '11:00',
      startDate: item.startDate,
      endDate: item.endDate,
      maxUses: item.maxUses,
      audienceType: item.audienceType,
      customerPhonesText,
      notifyCustomers: item.notifyStatus !== 'NONE',
    };
  };

  const detailSource =
    editPromoId && promoDetailQ.data?.promotionId === editPromoId ? promoDetailQ.data : null;

  const promoForm: PromoFormState =
    promoFormDraft ??
    (detailSource
      ? promoFromItem(
          detailSource,
          detailSource.customers.map((c) => c.phone).join(', '),
        )
      : editPromoSnapshot
        ? promoFromItem(editPromoSnapshot)
        : makeEmptyPromoForm());

  const setPromoForm = (updater: (prev: PromoFormState) => PromoFormState) => {
    setPromoFormDraft((prev) => updater(prev ?? promoForm));
  };

  const openCreatePromo = () => {
    setEditPromoId(null);
    setEditPromoSnapshot(null);
    setPromoFormDraft(makeEmptyPromoForm());
    setPromoErr('');
    setMissingPhones([]);
    setPromoModalOpen(true);
  };

  const openEditPromo = (p: AdminPromotionItem) => {
    setEditPromoId(p.promotionId);
    setEditPromoSnapshot(p);
    setPromoFormDraft(null);
    setPromoErr('');
    setMissingPhones([]);
    setPromoModalOpen(true);
  };

  const toggleId = (list: number[], id: number) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleTogglePause = async (p: AdminPromotionItem) => {
    setBusyPromoId(p.promotionId);
    try {
      if (p.status === 'ACTIVE') {
        await pausePromotion(p.promotionId);
        toast(`Đã tạm dừng mã ${p.code}.`, 'ok');
      } else {
        await resumePromotion(p.promotionId);
        toast(`Mã ${p.code} đã chạy lại.`, 'ok');
      }
      await queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all });
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setBusyPromoId(null);
    }
  };

  const handleDeletePromo = async (p: AdminPromotionItem) => {
    setBusyPromoId(p.promotionId);
    try {
      const res = await deletePromotion(p.promotionId);
      if (res.deleted) {
        toast(`Đã xóa mã ${p.code} (chưa có lượt sử dụng).`, 'ok');
      } else {
        toast(
          res.message || `Mã ${p.code} đã có lượt sử dụng nên chuyển sang Ngừng áp dụng.`,
          'info',
        );
      }
      await queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all });
      if (editPromoId === p.promotionId) {
        setPromoModalOpen(false);
        setEditPromoId(null);
      }
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setBusyPromoId(null);
    }
  };

  const handleNotifyPromo = async (p: AdminPromotionItem) => {
    setBusyPromoId(p.promotionId);
    try {
      const res = await notifyPromotion(p.promotionId);
      await queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all });
      toast(
        res.notifyStatus === 'SENT'
          ? `Đã gửi thông báo chương trình ${p.code} tới khách hàng.`
          : `Trạng thái thông báo ${p.code}: ${NOTIFY_STATUS_LABELS[res.notifyStatus]}.`,
        res.notifyStatus === 'FAILED' ? 'err' : 'ok',
      );
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setBusyPromoId(null);
    }
  };

  const handleSavePromo = async (e: FormEvent) => {
    e.preventDefault();
    const code = promoForm.code.trim().toUpperCase();
    const name = promoForm.name.trim();

    if (name.length < 5 || name.length > 150) {
      return setPromoErr('Tên chương trình ưu đãi phải từ 5 đến 150 ký tự.');
    }
    if (!/^[A-Z0-9]{4,20}$/.test(code)) {
      return setPromoErr('Mã giảm giá gồm 4–20 ký tự chữ hoa hoặc số, không dấu.');
    }
    if (!promoForm.startDate || !promoForm.endDate || promoForm.endDate < promoForm.startDate) {
      return setPromoErr('Khoảng ngày áp dụng không hợp lệ.');
    }
    if (!(promoForm.maxUses > 0)) {
      return setPromoErr('Số lượt dùng tối đa phải lớn hơn 0.');
    }
    if (
      promoForm.discountType === 'PERCENT' &&
      (promoForm.discountValue < 1 || promoForm.discountValue > 100)
    ) {
      return setPromoErr('Mức giảm phần trăm phải từ 1% đến 100%.');
    }
    if (promoForm.discountType === 'FIXED' && !(promoForm.discountValue > 0)) {
      return setPromoErr('Số tiền giảm cố định phải lớn hơn 0.');
    }
    const maxDiscountNum = promoForm.maxDiscountAmount.trim()
      ? Number(promoForm.maxDiscountAmount)
      : null;
    if (
      promoForm.discountType === 'PERCENT' &&
      maxDiscountNum !== null &&
      !(maxDiscountNum > 0 && Number.isInteger(maxDiscountNum))
    ) {
      return setPromoErr('Trần giảm tối đa phải là số nguyên dương.');
    }
    if (!promoForm.allBranches && promoForm.branchIds.length === 0) {
      return setPromoErr('Vui lòng chọn ít nhất 1 chi nhánh áp dụng.');
    }
    if (!promoForm.allSports && promoForm.sportIds.length === 0) {
      return setPromoErr('Vui lòng chọn ít nhất 1 bộ môn áp dụng.');
    }

    const [timeFrom, timeTo] =
      promoForm.frameIdx >= 0
        ? [FRAMES[promoForm.frameIdx][1], FRAMES[promoForm.frameIdx][2]]
        : [promoForm.customFrom, promoForm.customTo];

    if ((timeFrom && !timeTo) || (!timeFrom && timeTo)) {
      return setPromoErr('Khung giờ tùy chỉnh phải có đủ giờ bắt đầu và kết thúc.');
    }
    if (timeFrom && timeTo && timeFrom >= timeTo) {
      return setPromoErr('Khung giờ tùy chỉnh không hợp lệ (giờ kết thúc phải sau giờ bắt đầu).');
    }

    const customerPhones = promoForm.customerPhonesText
      .split(/[,\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (promoForm.audienceType === 'SPECIFIC') {
      if (customerPhones.length === 0) {
        return setPromoErr('Vui lòng nhập ít nhất một số điện thoại khách hàng được chỉ định.');
      }
      if (customerPhones.some((p) => !/^0\d{9}$/.test(p))) {
        return setPromoErr(
          'Danh sách số điện thoại khách hàng không hợp lệ (mỗi số 10 chữ số, bắt đầu bằng 0).',
        );
      }
    }

    const payload = {
      name,
      code,
      description: promoForm.description.trim() || null,
      discountType: promoForm.discountType,
      discountValue: promoForm.discountValue,
      maxDiscountAmount: promoForm.discountType === 'PERCENT' ? maxDiscountNum : null,
      allBranches: promoForm.allBranches,
      branchIds: promoForm.allBranches ? [] : promoForm.branchIds,
      allSports: promoForm.allSports,
      sportIds: promoForm.allSports ? [] : promoForm.sportIds,
      timeFrom,
      timeTo,
      startDate: promoForm.startDate,
      endDate: promoForm.endDate,
      maxUses: promoForm.maxUses,
      audienceType: promoForm.audienceType,
      customerPhones: promoForm.audienceType === 'SPECIFIC' ? customerPhones : [],
      notifyCustomers: promoForm.notifyCustomers,
    };

    setPromoErr('');
    setMissingPhones([]);
    setPromoSaving(true);
    try {
      if (editPromoId) {
        await updatePromotion(editPromoId, payload);
        toast(`Đã cập nhật mã ${code}.`, 'ok');
      } else {
        await createPromotion(payload);
        toast(
          `Đã phát hành mã ${code}${promoForm.notifyCustomers ? ' và gửi thông báo cho khách hàng' : ''}.`,
          'ok',
        );
      }
      await queryClient.invalidateQueries({ queryKey: adminPromotionsKeys.all });
      setPromoModalOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CUSTOMER_NOT_FOUND') {
        const phones = extractCustomerNotFoundPhones(err);
        setMissingPhones(phones);
        setPromoErr(extractErrorMessage(err, 'Một số số điện thoại chưa đăng ký tài khoản khách hàng.'));
      } else {
        setPromoErr(extractErrorMessage(err));
      }
    } finally {
      setPromoSaving(false);
    }
  };

  const renderReportCells = (r: RevenueReportRow) => (
    <>
      <td className="r w700">{fmt(r.orders)}</td>
      <td className="r w700 c-brand8">{fmt(r.completed)}</td>
      <td className="r w700 c-rose">{fmt(r.canceled)}</td>
      <td className="r w800 c-brand8">{r.capacityHours > 0 ? `${r.occupancyRate}%` : '—'}</td>
      <td className="r w700">{money(r.fromCompleted)}</td>
      <td className="r w700">{money(r.fromUpcoming)}</td>
      <td className="r w700">{money(r.fromCanceled)}</td>
      <td className="r w700">{money(r.grossCollected)}</td>
      <td className="r w700 c-rose">{money(r.totalRefunded)}</td>
      <td className="r w800 c-ink">{money(r.netRevenue)}</td>
    </>
  );

  const reportCols = [
    'Tổng đơn',
    'Hoàn thành',
    'Đơn hủy',
    'Công suất',
    'Hoàn thành',
    'Sắp chơi',
    'Cọc giữ lại',
    'Tổng thu',
    'Hoàn trả',
    'Doanh thu ròng',
  ];

  const qrPct =
    summary && summary.grossCollected > 0
      ? ((summary.bankTransfer / summary.grossCollected) * 100).toFixed(1).replace('.', ',')
      : '0';

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          <button
            type="button"
            className={`btn btn-md ${tab === 'revenue' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ background: tab === 'revenue' ? undefined : 'var(--s100)' }}
            onClick={() => setTab('revenue')}
          >
            Báo cáo doanh thu
          </button>
          <button
            type="button"
            className={`btn btn-md ${tab === 'promotions' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ background: tab === 'promotions' ? undefined : 'var(--s100)' }}
            onClick={() => setTab('promotions')}
          >
            Quản lý khuyến mãi ({promotions.length})
          </button>
        </div>
        <span className="t12 c-s600">
          {tab === 'revenue'
            ? 'Số liệu tổng hợp trực tiếp từ backend theo kỳ báo cáo'
            : 'Tạo, chỉnh sửa, tạm dừng và gửi thông báo mã khuyến mãi'}
        </span>
      </section>

      {tab === 'revenue' && (
        <>
          <section className="card row between wrap g16" style={{ padding: 16 }}>
            <div className="row g12 wrap">
              <span className="t12 w700 c-s700">Kỳ báo cáo:</span>
              <input
                type="date"
                className="input sm"
                style={{ width: 'auto' }}
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
              />
              <span className="t12 w600 c-s600">đến</span>
              <input
                type="date"
                className="input sm"
                style={{ width: 'auto' }}
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
              />
              <span className="chip-box" style={{ borderRadius: 8, background: 'var(--s50)' }}>
                {branchLabel}
              </span>
              <select
                data-testid="report-court-filter"
                className="select sm fit"
                style={{ background: 'var(--s50)' }}
                value={effectiveCourtId === 'all' ? 'all' : String(effectiveCourtId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCourtIdFilter(v === 'all' ? 'all' : Number(v));
                }}
              >
                <option value="all">Tất cả sân</option>
                {courtOptions.map((c) => (
                  <option key={c.courtId} value={c.courtId}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-md"
                style={{ padding: '8px 16px' }}
                onClick={applyFilter}
              >
                Lọc dữ liệu
              </button>
            </div>
            <span className="t12 c-s600">Dữ liệu tính trực tiếp từ đơn đặt sân & giao dịch</span>
          </section>

          {reportQ.isLoading && (
            <div className="card center t12 c-s600" style={{ padding: 32 }}>
              Đang tải báo cáo doanh thu...
            </div>
          )}

          {reportQ.isError && (
            <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
              {extractErrorMessage(reportQ.error, 'Không thể tải báo cáo doanh thu.')}
            </div>
          )}

          {report && summary && (
            <>
              {report.isEmpty && (
                <div
                  className="hint"
                  style={{
                    background: 'var(--amber-50)',
                    borderColor: 'var(--amber-300)',
                    color: 'var(--amber-900)',
                    textAlign: 'center',
                    padding: 16,
                  }}
                >
                  Không có dữ liệu phát sinh trong khoảng thời gian đã chọn.
                </div>
              )}

              <div className="row g16 wrap" style={{ alignItems: 'stretch' }}>
                <div className="hero col g8" style={{ padding: 20, borderRadius: 16, flex: 1.25 }}>
                  <span className="t12 w700" style={{ color: 'var(--brand-100)' }}>
                    Doanh thu ròng ({toVN(report.period.from)} – {toVN(report.period.to)})
                  </span>
                  <div className="t24 w800" style={{ fontSize: 28, lineHeight: '36px' }}>
                    {vnd(summary.netRevenue)}
                  </div>
                  <p className="t12" style={{ color: 'var(--brand-100)' }}>
                    Tổng thu: {vnd(summary.grossCollected)} • Hoàn trả:{' '}
                    {vnd(summary.totalRefunded)}
                  </p>
                  <p className="t11" style={{ color: 'var(--brand-100)' }}>
                    Chuyển khoản QR: {formatMillion(summary.bankTransfer)} ({qrPct}%) • Tiền mặt:{' '}
                    {formatMillion(summary.cash)}
                  </p>
                </div>

                <div className="card col g8 f1" style={{ borderRadius: 16 }}>
                  <span className="t12 w700 c-s600">Chi tiết nguồn doanh thu</span>
                  <InfoRow k="• Đơn đã hoàn thành:" v={money(summary.fromCompleted)} c="c-ink" />
                  <InfoRow k="• Tiền thu lịch sắp chơi:" v={money(summary.fromUpcoming)} c="c-brand" />
                  <InfoRow k="• Tiền cọc đơn hủy giữ lại:" v={money(summary.fromCanceled)} c="c-amber" />
                  <span className="t11 c-s500">
                    Đơn đóng do cơ sở ({summary.byFacility}) không tính vào doanh thu.
                  </span>
                </div>

                <div className="card col g8 f1" style={{ borderRadius: 16 }}>
                  <span className="t12 w700 c-s600">
                    Lượt đặt & Công suất ({fmt(summary.orders)} đơn)
                  </span>
                  <InfoRow
                    k="• Hoàn thành:"
                    v={`${fmt(summary.completed)} đơn (${summary.completedRate}%)`}
                    c="c-brand8"
                  />
                  <InfoRow
                    k="• Khách hủy / Quá giờ:"
                    v={`${fmt(summary.canceled)} đơn (${summary.canceledRate}%)`}
                    c="c-rose"
                  />
                  <InfoRow
                    k="• Hết hạn giữ chỗ:"
                    v={`${fmt(summary.expired)} đơn (${summary.expiredRate}%)`}
                    c="c-amber"
                  />
                  <InfoRow
                    k="• Công suất sử dụng sân:"
                    v={`${summary.occupancyRate}% (${summary.bookedHours}h / ${summary.capacityHours}h)`}
                    c="c-ink"
                  />
                </div>

                <div className="card col g8 f1" style={{ borderRadius: 16 }}>
                  <span className="t12 w700 c-s600">Hiệu quả chương trình ưu đãi</span>
                  <div className="t24 w800 c-ink" style={{ fontSize: 22 }}>
                    {fmt(report.promotion.orders)} đơn dùng mã
                  </div>
                  <div className="t11 c-s600">
                    Tổng giảm: <b className="c-rose">{vnd(report.promotion.discountTotal)}</b>
                  </div>
                  <div className="t11 c-s600">
                    Doanh thu từ đơn dùng mã:{' '}
                    <b className="c-brand">{vnd(report.promotion.revenue)}</b>
                  </div>
                </div>
              </div>

              <section className="card card-lg col g16" style={{ padding: 20 }}>
                <div className="row between wrap g12">
                  <h2 className="t14 w800 c-ink">
                    Bảng tổng hợp doanh thu & tỷ lệ lấp đầy theo từng chi nhánh
                  </h2>
                  <span className="t12 c-s600">
                    Kỳ: {toVN(report.period.from)} – {toVN(report.period.to)}
                  </span>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Chi nhánh</th>
                        {reportCols.map((h) => (
                          <th key={h} className="r">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.byBranch.length === 0 && (
                        <tr>
                          <td
                            colSpan={reportCols.length + 1}
                            style={{ textAlign: 'center', padding: 24, color: 'var(--s600)' }}
                          >
                            Không có dữ liệu chi nhánh.
                          </td>
                        </tr>
                      )}
                      {report.byBranch.map((r) => (
                        <tr key={r.key}>
                          <td className="w700 c-ink" style={{ fontSize: 12 }}>
                            {r.name} ({r.courtCount} sân)
                          </td>
                          {renderReportCells(r)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card card-lg col g16" style={{ padding: 20 }}>
                <div className="row between wrap g12">
                  <h2 className="t14 w800 c-ink">So sánh chi tiết theo từng sân</h2>
                  <span className="t12 c-s600">{report.byCourt.length} sân trong bộ lọc</span>
                </div>
                <div className="tbl-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  <table className="tbl" data-testid="report-by-court-table">
                    <thead>
                      <tr>
                        <th>Sân</th>
                        {reportCols.map((h) => (
                          <th key={h} className="r">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.byCourt.length === 0 && (
                        <tr>
                          <td
                            colSpan={reportCols.length + 1}
                            style={{ textAlign: 'center', padding: 24, color: 'var(--s600)' }}
                          >
                            Không có dữ liệu sân.
                          </td>
                        </tr>
                      )}
                      {report.byCourt.map((r) => (
                        <tr key={r.key}>
                          <td className="w700 c-ink" style={{ fontSize: 12 }}>
                            {r.name}
                            <div className="t11 c-s500 mono">{r.key}</div>
                          </td>
                          {renderReportCells(r)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {tab === 'promotions' && (
        <>
          <section className="card row between wrap g16" style={{ padding: 16 }}>
            <div className="row g12 wrap">
              <input
                className="input sm"
                style={{ width: 240, background: 'var(--s50)', borderRadius: 12 }}
                placeholder="Tìm theo mã hoặc tên chương trình"
                value={promoSearch}
                onChange={(e) => setPromoSearch(e.target.value)}
              />
              <select
                className="select sm fit"
                style={{ background: 'var(--s50)', borderRadius: 12 }}
                value={promoStatusFilter}
                onChange={(e) => setPromoStatusFilter(e.target.value as 'ALL' | PromotionStatus)}
              >
                <option value="ALL">Mọi trạng thái</option>
                <option value="ACTIVE">Đang chạy</option>
                <option value="PAUSED">Tạm dừng</option>
                <option value="DISCONTINUED">Ngừng áp dụng</option>
              </select>
            </div>
            <button type="button" className="btn btn-primary btn-md" onClick={openCreatePromo}>
              + Tạo khuyến mãi mới
            </button>
          </section>

          <section className="card card-lg col g16" style={{ padding: 20 }}>
            <div className="col g2">
              <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
                Chương trình khuyến mãi & Mã giảm giá
              </h2>
              <p className="t12 c-s600">
                Mã đã có lượt dùng sẽ chuyển sang Ngừng áp dụng khi xóa.
              </p>
            </div>

            {promotionsQ.isLoading && (
              <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
                Đang tải danh sách khuyến mãi...
              </div>
            )}
            {promotionsQ.isError && (
              <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
                {extractErrorMessage(promotionsQ.error, 'Không thể tải danh sách khuyến mãi.')}
              </div>
            )}
            {!promotionsQ.isLoading && promotions.length === 0 && (
              <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
                Không tìm thấy chương trình khuyến mãi nào.
              </div>
            )}

            {promotions.map((p) => {
              const st = PROMO_STATUS_META[p.status];
              const isBusy = busyPromoId === p.promotionId;
              const branchScope = p.allBranches
                ? 'Tất cả cơ sở'
                : p.branches.map((b) => b.name).join(', ');
              const sportScope = p.allSports
                ? ''
                : ` • ${p.sports.map((s) => s.name).join(', ')}`;
              return (
                <div
                  key={p.promotionId}
                  data-testid={`promo-card-${p.code}`}
                  className="row between g12 wrap"
                  style={{
                    background: p.status === 'ACTIVE' ? 'var(--s50)' : 'var(--s100)',
                    border: '1px solid var(--s300)',
                    borderRadius: 12,
                    padding: 16,
                    opacity: p.status === 'ACTIVE' ? 1 : 0.85,
                  }}
                >
                  <div className="col g6 f1">
                    <div className="row g8 wrap">
                      <span
                        className="badge sq c-white mono"
                        style={{ background: 'var(--brand-800)', fontSize: 11 }}
                      >
                        {p.code}
                      </span>
                      <b className="t14 c-ink">{p.name}</b>
                      <span
                        className={`badge ${st.cls}`}
                        style={{ padding: '2px 10px', fontSize: 10, fontWeight: 700 }}
                      >
                        {st.label}
                      </span>
                      <span
                        className={`badge ${p.notifyStatus === 'SENT' ? 'b-sky' : p.notifyStatus === 'FAILED' ? 'b-rose' : 'b-gray'}`}
                        style={{ padding: '2px 10px', fontSize: 10 }}
                      >
                        {NOTIFY_STATUS_LABELS[p.notifyStatus]}
                      </span>
                    </div>
                    <p className="t11 c-s700">
                      Giảm:{' '}
                      <b className="c-brand8">
                        {formatPromoSummary(p.discountType, p.discountValue, p.maxDiscountAmount)}
                      </b>{' '}
                      • {branchScope}
                      {sportScope} •{' '}
                      {p.timeFrom && p.timeTo
                        ? `Khung ${p.timeFrom} – ${p.timeTo}`
                        : 'Mọi khung giờ'}{' '}
                      • {toVN(p.startDate)} – {toVN(p.endDate)}
                      {p.audienceType === 'SPECIFIC'
                        ? ` • Dành cho ${p.customerCount} khách chỉ định`
                        : ''}
                    </p>
                    <p className="t11 c-s700">
                      Lượt sử dụng:{' '}
                      <b>
                        {p.usedCount} / {p.maxUses} lượt
                      </b>
                    </p>
                  </div>
                  <div className="row g8 wrap">
                    {p.status !== 'DISCONTINUED' && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ color: 'var(--s800)' }}
                          disabled={isBusy}
                          onClick={() => openEditPromo(p)}
                        >
                          Chỉnh sửa
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${p.status === 'ACTIVE' ? 'btn-warn-o' : 'btn-green-o'}`}
                          disabled={isBusy}
                          onClick={() => void handleTogglePause(p)}
                        >
                          {p.status === 'ACTIVE' ? 'Tạm dừng' : 'Chạy lại'}
                        </button>
                        {p.status === 'ACTIVE' && p.notifyStatus !== 'SENT' && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            disabled={isBusy}
                            onClick={() => void handleNotifyPromo(p)}
                          >
                            Gửi thông báo
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger-o btn-sm"
                          data-testid={`promo-delete-${p.code}`}
                          disabled={isBusy}
                          onClick={() => void handleDeletePromo(p)}
                        >
                          Xóa
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      {promoModalOpen && (
        <div className="modal-bg" onClick={() => !promoSaving && setPromoModalOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 660, maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="col head-rule" style={{ gap: 2 }}>
              <span className="eyebrow">
                {editPromoId
                  ? `Chỉnh sửa chương trình ${promoForm.code}`
                  : 'Tạo chương trình mới'}
              </span>
              <h3 className="t18 w800 c-ink">Phát hành mã giảm giá & Gửi thông báo</h3>
            </div>

            {editPromoId && promoDetailQ.isLoading && (
              <div className="hint" style={{ padding: 10 }}>
                Đang tải chi tiết khách hàng chỉ định...
              </div>
            )}

            <form noValidate className="col g12" onSubmit={(e) => void handleSavePromo(e)}>
              <div data-testid="promo-discount-type" className="row g8">
                {(
                  [
                    ['PERCENT', 'Giảm theo %'],
                    ['FIXED', 'Giảm số tiền (VNĐ)'],
                  ] as const
                ).map(([kind, label]) => (
                  <label
                    key={kind}
                    className={`radio-card f1${promoForm.discountType === kind ? ' on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="dtype"
                      checked={promoForm.discountType === kind}
                      onChange={() =>
                        setPromoForm((f) => ({
                          ...f,
                          discountType: kind,
                          discountValue: kind === 'PERCENT' ? 10 : 50000,
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div>
                <label className="label">Tên chương trình ưu đãi *</label>
                <input
                  className="input sm"
                  placeholder="VD: Ưu đãi khung giờ vàng buổi sáng"
                  value={promoForm.name}
                  onChange={(e) => setPromoForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="row g12">
                <div className="f1">
                  <label className="label">Mã giảm giá *</label>
                  <input
                    className="input sm"
                    style={{ color: 'var(--brand-700)', fontWeight: 800 }}
                    value={promoForm.code}
                    disabled={
                      Boolean(editPromoId) && (promoDetailQ.data?.usedCount ?? 0) > 0
                    }
                    placeholder="SANGVUI20"
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                    }
                  />
                </div>
                <div className="f1">
                  <label className="label">
                    {promoForm.discountType === 'PERCENT'
                      ? 'Mức giảm (%) *'
                      : 'Số tiền giảm (VNĐ) *'}
                  </label>
                  <input
                    data-testid={
                      promoForm.discountType === 'FIXED' ? 'promo-fixed-amount' : undefined
                    }
                    className="input sm"
                    type="number"
                    min={1}
                    max={promoForm.discountType === 'PERCENT' ? 100 : undefined}
                    step={promoForm.discountType === 'PERCENT' ? 1 : 1000}
                    value={promoForm.discountValue}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, discountValue: Number(e.target.value) }))
                    }
                  />
                </div>
                {promoForm.discountType === 'PERCENT' && (
                  <div className="f1">
                    <label className="label">Giảm tối đa (VNĐ)</label>
                    <input
                      className="input sm"
                      type="number"
                      min={1000}
                      step={1000}
                      placeholder="Không giới hạn"
                      value={promoForm.maxDiscountAmount}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, maxDiscountAmount: e.target.value }))
                      }
                    />
                  </div>
                )}
              </div>

              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="f1 col g6">
                  <label className="row g6 t12 w700 c-s800" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={promoForm.allBranches}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, allBranches: e.target.checked }))
                      }
                    />
                    Áp dụng tất cả chi nhánh
                  </label>
                  {!promoForm.allBranches && (
                    <div
                      className="col g4"
                      style={{
                        background: 'var(--s50)',
                        border: '1px solid var(--s300)',
                        borderRadius: 8,
                        padding: 8,
                      }}
                    >
                      {branches.map((b) => (
                        <label key={b.branchId} className="row g6 t12" style={{ cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={promoForm.branchIds.includes(b.branchId)}
                            onChange={() =>
                              setPromoForm((f) => ({
                                ...f,
                                branchIds: toggleId(f.branchIds, b.branchId),
                              }))
                            }
                          />
                          {b.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="f1 col g6">
                  <label className="row g6 t12 w700 c-s800" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={promoForm.allSports}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, allSports: e.target.checked }))
                      }
                    />
                    Áp dụng tất cả bộ môn
                  </label>
                  {!promoForm.allSports && (
                    <div
                      className="col g4"
                      style={{
                        background: 'var(--s50)',
                        border: '1px solid var(--s300)',
                        borderRadius: 8,
                        padding: 8,
                      }}
                    >
                      {sports.map((s) => (
                        <label key={s.sportId} className="row g6 t12" style={{ cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={promoForm.sportIds.includes(s.sportId)}
                            onChange={() =>
                              setPromoForm((f) => ({
                                ...f,
                                sportIds: toggleId(f.sportIds, s.sportId),
                              }))
                            }
                          />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="row g12">
                <div className="f1">
                  <label className="label">Khung giờ áp dụng *</label>
                  <select
                    className="select sm"
                    value={promoForm.frameIdx}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, frameIdx: Number(e.target.value) }))
                    }
                  >
                    {FRAMES.map(([label], i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                    <option value={-1}>Tùy chỉnh…</option>
                  </select>
                </div>
                <div className="f1">
                  <label className="label">Đối tượng khách hàng</label>
                  <select
                    className="select sm"
                    value={promoForm.audienceType}
                    onChange={(e) =>
                      setPromoForm((f) => ({
                        ...f,
                        audienceType: e.target.value as AudienceType,
                      }))
                    }
                  >
                    <option value="ALL">Tất cả khách hàng</option>
                    <option value="SPECIFIC">Khách hàng chỉ định</option>
                  </select>
                </div>
              </div>

              {promoForm.frameIdx === -1 && (
                <div className="row g12">
                  <div className="f1">
                    <label className="label">Từ giờ (HH:mm)</label>
                    <input
                      className="input sm"
                      type="time"
                      value={promoForm.customFrom}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, customFrom: e.target.value }))
                      }
                    />
                  </div>
                  <div className="f1">
                    <label className="label">Đến giờ (HH:mm)</label>
                    <input
                      className="input sm"
                      type="time"
                      value={promoForm.customTo}
                      onChange={(e) =>
                        setPromoForm((f) => ({ ...f, customTo: e.target.value }))
                      }
                    />
                  </div>
                </div>
              )}

              {promoForm.audienceType === 'SPECIFIC' && (
                <div>
                  <label className="label">
                    Số điện thoại khách hàng (cách nhau bằng dấu phẩy) *
                  </label>
                  <input
                    className="input sm"
                    placeholder="0987654321, 0912345678"
                    value={promoForm.customerPhonesText}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, customerPhonesText: e.target.value }))
                    }
                  />
                </div>
              )}

              <div className="row g12">
                <div className="f1">
                  <label className="label">Từ ngày *</label>
                  <input
                    className="input sm"
                    type="date"
                    value={promoForm.startDate}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, startDate: e.target.value }))
                    }
                  />
                </div>
                <div className="f1">
                  <label className="label">Đến ngày *</label>
                  <input
                    className="input sm"
                    type="date"
                    value={promoForm.endDate}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, endDate: e.target.value }))
                    }
                  />
                </div>
                <div className="f1">
                  <label className="label">Số lượt dùng *</label>
                  <input
                    className="input sm"
                    type="number"
                    min={1}
                    value={promoForm.maxUses}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, maxUses: Number(e.target.value) }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="label">Mô tả chương trình (tùy chọn)</label>
                <input
                  className="input sm"
                  placeholder="Nội dung chi tiết gửi kèm thông báo cho khách"
                  value={promoForm.description}
                  onChange={(e) =>
                    setPromoForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>

              {!editPromoId && (
                <label
                  className="row g10 hint hint-green"
                  style={{ padding: 12, cursor: 'pointer', background: 'var(--brand-50)' }}
                >
                  <input
                    type="checkbox"
                    checked={promoForm.notifyCustomers}
                    onChange={(e) =>
                      setPromoForm((f) => ({ ...f, notifyCustomers: e.target.checked }))
                    }
                    style={{ accentColor: '#0075ff', width: 14, height: 14 }}
                  />
                  <span className="w700 c-ink">
                    Gửi thông báo chương trình ưu đãi này tới khách hàng
                  </span>
                </label>
              )}

              {promoErr && (
                <div className="col g4">
                  <p className="field-err">{promoErr}</p>
                  {missingPhones.length > 0 && (
                    <div
                      className="hint"
                      style={{
                        background: 'var(--rose-50)',
                        borderColor: 'var(--rose-300)',
                        color: 'var(--rose-900)',
                      }}
                    >
                      SĐT chưa có tài khoản hội viên:{' '}
                      <b className="mono">{missingPhones.join(', ')}</b>
                    </div>
                  )}
                </div>
              )}

              <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-md"
                  disabled={promoSaving}
                  onClick={() => setPromoModalOpen(false)}
                >
                  Đóng
                </button>
                <button type="submit" className="btn btn-primary btn-md" disabled={promoSaving}>
                  {promoSaving
                    ? 'Đang lưu...'
                    : editPromoId
                      ? 'Lưu thay đổi'
                      : 'Lưu & Phát hành ưu đãi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function InfoRow({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div className="row between g8 t11" style={{ fontSize: 11.5 }}>
      <b className="c-ink" style={{ fontWeight: 700 }}>
        {k}
      </b>
      <b className={c}>{v}</b>
    </div>
  );
}
