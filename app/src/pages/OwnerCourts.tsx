import { useState } from 'react';
import type { FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { BlockType, CourtStatus, DepositType } from '@sporthub/shared';
import {
  adminCourtsKeys,
  createCourtApi,
  createCourtBlockApi,
  createHolidayApi,
  deleteHolidayApi,
  releaseCourtBlockApi,
  updateCourtApi,
  updateOpeningHoursApi,
  useAdminCourtDetail,
  useAdminCourts,
  useCourtBlocks,
  useHolidays,
  useOpeningHours,
  type AdminCourtItem,
  type AdminCourtPriceRuleInput,
  type AdminHolidayItem,
  type AdminOpeningHourDay,
  type CourtDisplayStatus,
  type HolidayScope,
} from '../api/adminCourts.ts';
import { affectedKeys, type AffectedBookingItem } from '../api/affected.ts';
import { availabilityKeys } from '../api/availability.ts';
import { catalogKeys, useSports } from '../api/catalog.ts';
import { queryClient } from '../api/queryClient.ts';
import AffectedBookingsModal from '../components/AffectedBookingsModal.tsx';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import {
  addDays,
  extractErrorMessage,
  fmt,
  formatDateTimeVn,
  formatDepositRule,
  mins,
  todayVn,
  toVN,
} from '../utils/format.ts';

type Tab = 1 | 2 | 3;

const DAYS: [number, string][] = [
  [1, 'Thứ Hai'],
  [2, 'Thứ Ba'],
  [3, 'Thứ Tư'],
  [4, 'Thứ Năm'],
  [5, 'Thứ Sáu'],
  [6, 'Thứ Bảy'],
  [7, 'Chủ Nhật'],
];

const MASK_OPTIONS: [number, string][] = [
  [127, 'Cả tuần'],
  [31, 'Thứ 2 – Thứ 6'],
  [96, 'Cuối tuần (T7–CN)'],
];

const DISPLAY_STATUS_META: Record<CourtDisplayStatus, { cls: string; label: string }> = {
  ACTIVE: { cls: 'b-green', label: 'Đang mở' },
  MAINTENANCE: { cls: 'b-amber', label: 'Đang bảo trì' },
  DECOMMISSIONED: { cls: 'b-rose', label: 'Ngừng khai thác' },
  INACTIVE: { cls: 'b-gray', label: 'Ngừng hoạt động' },
};

interface PriceRuleDraft {
  label: string;
  dayOfWeekMask: number;
  startTime: string;
  endTime: string;
  pricePerHour: number;
}

interface CourtFormState {
  name: string;
  branchId: number;
  sportId: number;
  courtType: string;
  description: string;
  depositType: DepositType;
  depositValue: number;
  status: CourtStatus;
  priceRules: PriceRuleDraft[];
}

type DryRunConfirmState =
  | {
      kind: 'block';
      title: string;
      affectedCount: number;
      affectedBookings: AffectedBookingItem[];
      onConfirm: () => Promise<void>;
    }
  | {
      kind: 'hours';
      title: string;
      affectedCount: number;
      affectedBookings: AffectedBookingItem[];
      onConfirm: () => Promise<void>;
    }
  | {
      kind: 'holiday';
      title: string;
      affectedCount: number;
      affectedBookings: AffectedBookingItem[];
      onConfirm: () => Promise<void>;
    };

function makeDefaultPriceRules(): PriceRuleDraft[] {
  return [
    { label: 'Giờ thường', dayOfWeekMask: 127, startTime: '05:00', endTime: '17:00', pricePerHour: 150000 },
    { label: 'Giờ cao điểm', dayOfWeekMask: 127, startTime: '17:00', endTime: '23:00', pricePerHour: 250000 },
  ];
}

function defaultOpeningDays(): AdminOpeningHourDay[] {
  return DAYS.map(([dayOfWeek]) => ({
    dayOfWeek,
    openTime: '05:00',
    closeTime: '23:00',
    isClosed: false,
  }));
}

function toVnIsoDateTime(localDt: string): string {
  if (!localDt) return localDt;
  if (localDt.length === 16) return `${localDt}:00+07:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(localDt)) return `${localDt}+07:00`;
  return localDt;
}

function maskLabel(mask: number): string {
  const found = MASK_OPTIONS.find(([m]) => m === mask);
  if (found) return found[1];
  const labels = DAYS.filter(([d]) => (mask & (1 << (d - 1))) !== 0).map(([d]) =>
    d === 7 ? 'CN' : `T${d + 1}`,
  );
  return labels.join(', ') || `Mask ${mask}`;
}

export default function OwnerCourts() {
  const { branchFilter, branches, activeBranchId } = useOutletContext<StaffOutlet>();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>(1);
  const scopedBranchId = branchFilter === 'all' ? undefined : branchFilter;

  const sportsQ = useSports();
  const courtsQ = useAdminCourts({ branchId: scopedBranchId });
  const blocksQ = useCourtBlocks({ branchId: scopedBranchId, active: true });
  const holidaysQ = useHolidays({ branchId: scopedBranchId });

  const sports = sportsQ.data ?? [];
  const courts = courtsQ.data ?? [];
  const blocks = blocksQ.data ?? [];
  const holidays = holidaysQ.data ?? [];

  // ===== Tab 1: Sân & Bảng giá =====
  const [courtModalOpen, setCourtModalOpen] = useState(false);
  const [editCourtId, setEditCourtId] = useState<number | null>(null);
  const courtDetailQ = useAdminCourtDetail(editCourtId, {
    enabled: courtModalOpen && editCourtId !== null,
  });

  const [courtForm, setCourtForm] = useState<CourtFormState>({
    name: '',
    branchId: 0,
    sportId: 0,
    courtType: '',
    description: '',
    depositType: 'PERCENT',
    depositValue: 30,
    status: 'ACTIVE',
    priceRules: makeDefaultPriceRules(),
  });
  const [courtErr, setCourtErr] = useState('');
  const [courtSaving, setCourtSaving] = useState(false);

  const openCreateCourt = () => {
    setEditCourtId(null);
    setCourtForm({
      name: '',
      branchId: activeBranchId ?? branches[0]?.branchId ?? 0,
      sportId: sports[0]?.sportId ?? 0,
      courtType: '',
      description: '',
      depositType: 'PERCENT',
      depositValue: 30,
      status: 'ACTIVE',
      priceRules: makeDefaultPriceRules(),
    });
    setCourtErr('');
    setCourtModalOpen(true);
  };

  const openEditCourt = (c: AdminCourtItem) => {
    setEditCourtId(c.courtId);
    setCourtForm({
      name: c.name,
      branchId: c.branch.branchId,
      sportId: c.sport.sportId,
      courtType: c.courtType ?? '',
      description: c.description ?? '',
      depositType: c.depositType,
      depositValue: c.depositValue,
      status: c.status,
      priceRules:
        c.priceRules.length > 0
          ? c.priceRules.map((r) => ({
              label: r.label,
              dayOfWeekMask: r.dayOfWeekMask,
              startTime: r.startTime,
              endTime: r.endTime,
              pricePerHour: r.pricePerHour,
            }))
          : makeDefaultPriceRules(),
    });
    setCourtErr('');
    setCourtModalOpen(true);
  };

  const setRuleField = (index: number, patch: Partial<PriceRuleDraft>) => {
    setCourtForm((prev) => ({
      ...prev,
      priceRules: prev.priceRules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  };

  const invalidateCourtRelated = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminCourtsKeys.all }),
      queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
      queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
      queryClient.invalidateQueries({ queryKey: affectedKeys.all }),
    ]);
  };

  const handleSaveCourt = async (e: FormEvent) => {
    e.preventDefault();
    const name = courtForm.name.trim();
    if (!name) return setCourtErr('Vui lòng nhập tên sân thi đấu.');
    if (name.length > 100) return setCourtErr('Tên sân tối đa 100 ký tự.');
    if (!courtForm.branchId) return setCourtErr('Vui lòng chọn chi nhánh.');
    if (!editCourtId && !courtForm.sportId) return setCourtErr('Vui lòng chọn bộ môn thể thao.');
    if (courtForm.description.length > 500) return setCourtErr('Mô tả sân tối đa 500 ký tự.');
    if (
      courtForm.depositType === 'PERCENT' &&
      !(courtForm.depositValue >= 10 && courtForm.depositValue <= 100)
    ) {
      return setCourtErr('Tỷ lệ đặt cọc phải nằm trong khoảng 10% – 100%.');
    }
    if (courtForm.depositType === 'FIXED' && !(courtForm.depositValue > 0)) {
      return setCourtErr('Tiền đặt cọc cố định phải lớn hơn 0.');
    }
    if (courtForm.priceRules.length === 0) {
      return setCourtErr('Cần có ít nhất một khung giá thuê.');
    }

    for (const r of courtForm.priceRules) {
      if (!r.label.trim()) return setCourtErr('Tên khung giá không được để trống.');
      if (!(r.pricePerHour > 0)) return setCourtErr('Đơn giá thuê của mỗi khung phải lớn hơn 0.');
      if (!r.startTime || !r.endTime || mins(r.endTime) <= mins(r.startTime)) {
        return setCourtErr(`Khung giá "${r.label || '—'}": giờ kết thúc phải sau giờ bắt đầu.`);
      }
    }

    const rules = courtForm.priceRules;
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        if ((rules[i].dayOfWeekMask & rules[j].dayOfWeekMask) === 0) continue;
        if (
          mins(rules[i].startTime) < mins(rules[j].endTime) &&
          mins(rules[j].startTime) < mins(rules[i].endTime)
        ) {
          return setCourtErr('Các khung giá không được chồng chéo thời gian trong cùng ngày áp dụng.');
        }
      }
    }

    const payloadRules: AdminCourtPriceRuleInput[] = [...rules]
      .sort((a, b) => mins(a.startTime) - mins(b.startTime))
      .map((r) => ({
        label: r.label.trim(),
        dayOfWeekMask: r.dayOfWeekMask,
        startTime: r.startTime,
        endTime: r.endTime,
        pricePerHour: r.pricePerHour,
      }));

    setCourtErr('');
    setCourtSaving(true);
    try {
      if (editCourtId) {
        const res = await updateCourtApi(editCourtId, {
          name,
          branchId: courtForm.branchId,
          courtType: courtForm.courtType.trim() || null,
          description: courtForm.description.trim() || null,
          depositType: courtForm.depositType,
          depositValue: courtForm.depositValue,
          status: courtForm.status,
          priceRules: payloadRules,
        });
        toast(
          res.affectedCount > 0
            ? `Đã cập nhật ${name}. Phát hiện ${res.affectedCount} đơn bị ảnh hưởng cần xử lý.`
            : `Đã cập nhật ${name}. Giá & mức cọc mới chỉ áp dụng cho đơn phát sinh sau thời điểm lưu.`,
          res.affectedCount > 0 ? 'info' : 'ok',
        );
      } else {
        await createCourtApi({
          name,
          branchId: courtForm.branchId,
          sportId: courtForm.sportId,
          courtType: courtForm.courtType.trim() || null,
          description: courtForm.description.trim() || null,
          depositType: courtForm.depositType,
          depositValue: courtForm.depositValue,
          status: courtForm.status,
          priceRules: payloadRules,
        });
        toast(`Đã thêm sân mới ${name}.`, 'ok');
      }
      await invalidateCourtRelated();
      setCourtModalOpen(false);
    } catch (err) {
      setCourtErr(extractErrorMessage(err));
    } finally {
      setCourtSaving(false);
    }
  };

  // ===== Tab 2: Khóa sân / Bảo trì =====
  const today = todayVn();
  const [blockForm, setBlockForm] = useState<{
    blockType: BlockType;
    courtId: string;
    startAt: string;
    endAt: string;
    reason: string;
  }>(() => ({
    blockType: 'MAINTENANCE',
    courtId: '',
    startAt: `${today}T08:00`,
    endAt: `${today}T18:00`,
    reason: 'Bảo trì mặt sân',
  }));
  const [blockErr, setBlockErr] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);
  const [releasingBlockId, setReleasingBlockId] = useState<number | null>(null);
  const [dryRunConfirm, setDryRunConfirm] = useState<DryRunConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const handleReleaseBlock = async (blockId: number, courtName: string) => {
    setReleasingBlockId(blockId);
    try {
      await releaseCourtBlockApi(blockId);
      await invalidateCourtRelated();
      toast(`Đã mở lại ${courtName}.`, 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setReleasingBlockId(null);
    }
  };

  const handleSubmitBlock = async (e: FormEvent) => {
    e.preventDefault();
    const cid = Number(blockForm.courtId);
    if (!cid) return setBlockErr('Vui lòng chọn sân cần khóa.');
    if (!blockForm.startAt) return setBlockErr('Vui lòng chọn thời điểm bắt đầu.');
    if (
      blockForm.blockType === 'MAINTENANCE' &&
      (!blockForm.endAt || blockForm.endAt <= blockForm.startAt)
    ) {
      return setBlockErr('Thời gian kết thúc phải sau thời gian bắt đầu.');
    }
    if (!blockForm.reason.trim()) return setBlockErr('Vui lòng nhập lý do khóa sân.');

    const payload = {
      courtId: cid,
      blockType: blockForm.blockType,
      startAt: toVnIsoDateTime(blockForm.startAt),
      endAt: blockForm.blockType === 'MAINTENANCE' ? toVnIsoDateTime(blockForm.endAt) : null,
      reason: blockForm.reason.trim(),
    };

    const executeCreate = async () => {
      await createCourtBlockApi(payload, { dryRun: false });
      await invalidateCourtRelated();
      toast(
        blockForm.blockType === 'DECOMMISSION'
          ? 'Đã chuyển sân sang trạng thái ngừng khai thác.'
          : 'Đã tạm khóa sân bảo trì.',
        'ok',
      );
    };

    setBlockErr('');
    setBlockBusy(true);
    try {
      const preview = await createCourtBlockApi(payload, { dryRun: true });
      if (preview.affectedCount > 0) {
        setDryRunConfirm({
          kind: 'block',
          title: 'Xác nhận khóa sân có đơn bị ảnh hưởng',
          affectedCount: preview.affectedCount,
          affectedBookings: preview.affectedBookings,
          onConfirm: executeCreate,
        });
      } else {
        await executeCreate();
      }
    } catch (err) {
      setBlockErr(extractErrorMessage(err));
    } finally {
      setBlockBusy(false);
    }
  };

  // ===== Tab 3: Giờ mở cửa & Ngày nghỉ =====
  const [selectedHoursBranchId, setSelectedHoursBranchId] = useState<number | null>(null);
  const effectiveHoursBranchId =
    branchFilter !== 'all'
      ? branchFilter
      : (selectedHoursBranchId ?? activeBranchId ?? branches[0]?.branchId ?? null);

  const openingHoursQ = useOpeningHours(effectiveHoursBranchId, {
    enabled: tab === 3 && effectiveHoursBranchId !== null,
  });

  const [hoursDraftByBranch, setHoursDraftByBranch] = useState<
    Record<number, AdminOpeningHourDay[]>
  >({});
  const [hoursErr, setHoursErr] = useState('');
  const [hoursBusy, setHoursBusy] = useState(false);

  const serverHoursDays: AdminOpeningHourDay[] =
    openingHoursQ.data?.days && openingHoursQ.data.days.length === 7
      ? openingHoursQ.data.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          openTime: d.openTime ?? '05:00',
          closeTime: d.closeTime ?? '23:00',
          isClosed: d.isClosed,
        }))
      : defaultOpeningDays();

  const hoursDraft: AdminOpeningHourDay[] =
    effectiveHoursBranchId !== null
      ? (hoursDraftByBranch[effectiveHoursBranchId] ?? serverHoursDays)
      : defaultOpeningDays();

  const setOpeningDay = (dayOfWeek: number, patch: Partial<AdminOpeningHourDay>) => {
    if (effectiveHoursBranchId === null) return;
    setHoursDraftByBranch((prev) => {
      const current = prev[effectiveHoursBranchId] ?? serverHoursDays;
      return {
        ...prev,
        [effectiveHoursBranchId]: current.map((d) =>
          d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d,
        ),
      };
    });
  };

  const applyMondayToAll = () => {
    if (effectiveHoursBranchId === null) return;
    setHoursDraftByBranch((prev) => {
      const current = prev[effectiveHoursBranchId] ?? serverHoursDays;
      const mon = current.find((d) => d.dayOfWeek === 1);
      if (!mon) return prev;
      return {
        ...prev,
        [effectiveHoursBranchId]: current.map((d) => ({
          ...d,
          openTime: mon.openTime,
          closeTime: mon.closeTime,
          isClosed: mon.isClosed,
        })),
      };
    });
  };

  const handleSaveHours = async () => {
    if (!effectiveHoursBranchId) return;
    for (const [dowNum, label] of DAYS) {
      const d = hoursDraft.find((x) => x.dayOfWeek === dowNum);
      if (!d) continue;
      if (!d.isClosed && (!d.openTime || !d.closeTime || mins(d.closeTime) <= mins(d.openTime))) {
        setHoursErr(`${label}: Giờ đóng cửa phải lớn hơn giờ mở cửa.`);
        return;
      }
    }

    const payload = {
      days: hoursDraft.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        openTime: d.isClosed ? null : (d.openTime ?? '05:00'),
        closeTime: d.isClosed ? null : (d.closeTime ?? '23:00'),
        isClosed: d.isClosed,
      })),
    };

    const executeSaveHours = async () => {
      const res = await updateOpeningHoursApi(effectiveHoursBranchId, payload, { dryRun: false });
      setHoursDraftByBranch((prev) => {
        const next = { ...prev };
        delete next[effectiveHoursBranchId];
        return next;
      });
      await invalidateCourtRelated();
      toast(
        res.affectedCount > 0
          ? `Đã lưu giờ mở cửa. Phát hiện ${res.affectedCount} đơn bị ảnh hưởng.`
          : 'Đã lưu giờ mở cửa chi nhánh.',
        res.affectedCount > 0 ? 'info' : 'ok',
      );
    };

    setHoursErr('');
    setHoursBusy(true);
    try {
      const preview = await updateOpeningHoursApi(effectiveHoursBranchId, payload, { dryRun: true });
      if (preview.affectedCount > 0) {
        setDryRunConfirm({
          kind: 'hours',
          title: 'Xác nhận đổi giờ mở cửa',
          affectedCount: preview.affectedCount,
          affectedBookings: preview.affectedBookings,
          onConfirm: executeSaveHours,
        });
      } else {
        await executeSaveHours();
      }
    } catch (err) {
      setHoursErr(extractErrorMessage(err));
    } finally {
      setHoursBusy(false);
    }
  };

  // Holidays state
  const [holidayForm, setHolidayForm] = useState<{
    startDate: string;
    days: number;
    scope: HolidayScope;
    branchId: number;
    reason: string;
  }>(() => ({
    startDate: '',
    days: 1,
    scope: 'ALL',
    branchId: activeBranchId ?? branches[0]?.branchId ?? 0,
    reason: '',
  }));
  const [holidayErr, setHolidayErr] = useState('');
  const [holidayBusy, setHolidayBusy] = useState(false);
  const [deletingHolidayId, setDeletingHolidayId] = useState<number | null>(null);

  const handleAddHoliday = async (e: FormEvent) => {
    e.preventDefault();
    if (!holidayForm.startDate) return setHolidayErr('Vui lòng chọn ngày nghỉ.');
    if (holidayForm.startDate < today) return setHolidayErr('Không thể thêm ngày nghỉ trong quá khứ.');
    if (!(holidayForm.days >= 1 && holidayForm.days <= 60)) {
      return setHolidayErr('Số ngày nghỉ liên tiếp phải từ 1 đến 60.');
    }
    const targetBranchId =
      holidayForm.scope === 'BRANCH'
        ? holidayForm.branchId || activeBranchId || branches[0]?.branchId || null
        : null;
    if (holidayForm.scope === 'BRANCH' && !targetBranchId) {
      return setHolidayErr('Vui lòng chọn chi nhánh áp dụng ngày nghỉ.');
    }

    const payload = {
      startDate: holidayForm.startDate,
      days: holidayForm.days,
      scope: holidayForm.scope,
      branchId: targetBranchId,
      reason: holidayForm.reason.trim() || 'Nghỉ lễ',
    };

    const executeCreateHoliday = async () => {
      const res = await createHolidayApi(payload, { dryRun: false });
      await invalidateCourtRelated();
      toast(
        res.affectedCount > 0
          ? `Đã thêm ngày nghỉ. Phát hiện ${res.affectedCount} đơn bị ảnh hưởng.`
          : 'Đã thêm ngày nghỉ lễ.',
        res.affectedCount > 0 ? 'info' : 'ok',
      );
      setHolidayForm((f) => ({ ...f, startDate: '', days: 1, reason: '' }));
    };

    setHolidayErr('');
    setHolidayBusy(true);
    try {
      const preview = await createHolidayApi(payload, { dryRun: true });
      if (preview.affectedCount > 0) {
        setDryRunConfirm({
          kind: 'holiday',
          title: 'Xác nhận thêm ngày nghỉ lễ',
          affectedCount: preview.affectedCount,
          affectedBookings: preview.affectedBookings,
          onConfirm: executeCreateHoliday,
        });
      } else {
        await executeCreateHoliday();
      }
    } catch (err) {
      setHolidayErr(extractErrorMessage(err));
    } finally {
      setHolidayBusy(false);
    }
  };

  const handleDeleteHoliday = async (h: AdminHolidayItem, group: boolean) => {
    setDeletingHolidayId(h.holidayId);
    try {
      await deleteHolidayApi(h.holidayId, h.groupKey ? { group } : undefined);
      await invalidateCourtRelated();
      toast(group ? 'Đã xóa cả nhóm ngày nghỉ.' : 'Đã xóa ngày nghỉ.', 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setDeletingHolidayId(null);
    }
  };

  const handleConfirmDryRun = async () => {
    if (!dryRunConfirm) return;
    setConfirmBusy(true);
    try {
      await dryRunConfirm.onConfirm();
      setDryRunConfirm(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setConfirmBusy(false);
    }
  };

  const tabs: [Tab, string][] = [
    [1, 'Sân & Bảng giá'],
    [2, 'Khóa sân / Bảo trì'],
    [3, 'Giờ mở cửa & Ngày nghỉ'],
  ];

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              type="button"
              className={`btn btn-md ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                background: tab === t ? undefined : 'var(--s100)',
                padding: tab === t ? '9px 16px' : '8px 16px',
              }}
              onClick={() => setTab(t)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row g12">
          <span className="t12 w600 c-s600">
            Tổng số: {courts.length} sân • {branches.length} chi nhánh
          </span>
          {tab === 1 && (
            <button type="button" className="btn btn-primary btn-md" onClick={openCreateCourt}>
              + Thêm sân mới
            </button>
          )}
        </div>
      </section>

      {tab === 1 && (
        <section className="card col g16">
          <div className="row between wrap g12">
            <h2 className="t14 w800 c-ink">Danh sách sân & Cấu hình giá theo khung giờ</h2>
            <span className="t12 c-s600">Nhấp "Cập nhật" để điều chỉnh giá hoặc mức cọc</span>
          </div>

          {courtsQ.isError && (
            <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
              {extractErrorMessage(courtsQ.error, 'Không thể tải danh sách sân.')}
            </div>
          )}

          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mã / Tên sân</th>
                  <th>Chi nhánh & Bộ môn</th>
                  <th>Đơn giá theo giờ</th>
                  <th>Đặt cọc</th>
                  <th>Trạng thái</th>
                  <th className="r">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {courtsQ.isLoading && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>
                      Đang tải danh sách sân...
                    </td>
                  </tr>
                )}
                {!courtsQ.isLoading && courts.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>
                      Chưa có sân nào trong bộ lọc hiện tại.
                    </td>
                  </tr>
                )}
                {courts.map((c) => {
                  const statusInfo = DISPLAY_STATUS_META[c.displayStatus];
                  const isWarn =
                    c.displayStatus === 'MAINTENANCE' || c.displayStatus === 'DECOMMISSIONED';
                  return (
                    <tr
                      key={c.courtId}
                      className={
                        isWarn ? 'warn-row' : editCourtId === c.courtId && courtModalOpen ? 'hl' : ''
                      }
                    >
                      <td>
                        <div className="mono w800" style={{ fontSize: 11.1 }}>
                          {c.code}
                        </div>
                        <div className="w700 c-s800">{c.name}</div>
                        {c.courtType && <div className="t11 c-s500">{c.courtType}</div>}
                      </td>
                      <td>
                        <div className="w700 c-brand8">{c.branch.name}</div>
                        <div className="c-s600">{c.sport.name}</div>
                      </td>
                      <td>
                        {c.priceRules.map((r) => (
                          <div key={r.priceRuleId}>
                            {r.startTime}–{r.endTime} ({r.label}): <b>{fmt(r.pricePerHour)}đ/h</b>
                            {r.dayOfWeekMask !== 127 && (
                              <span className="t11 c-s500"> [{maskLabel(r.dayOfWeekMask)}]</span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td>
                        <b className="w800">{formatDepositRule(c.depositType, c.depositValue)}</b>
                      </td>
                      <td>
                        <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
                        {c.activeBlock && (
                          <div className="t11 c-amber" style={{ marginTop: 4 }}>
                            {c.activeBlock.reason}
                          </div>
                        )}
                      </td>
                      <td className="r">
                        <div className="col g6" style={{ alignItems: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ color: 'var(--brand-800)' }}
                            onClick={() => openEditCourt(c)}
                          >
                            Cập nhật
                          </button>
                          {c.activeBlock && (
                            <button
                              type="button"
                              className="btn btn-warn-o btn-sm"
                              disabled={releasingBlockId === c.activeBlock.blockId}
                              onClick={() =>
                                void handleReleaseBlock(c.activeBlock!.blockId, c.name)
                              }
                            >
                              Mở lại sân
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="hint hint-green" style={{ padding: 14 }}>
            💡 Khi thay đổi bảng giá thuê hoặc mức đặt cọc, mức giá mới sẽ áp dụng cho các đơn đặt sân phát sinh sau thời điểm lưu; các đơn khách đã đặt trước đó vẫn được giữ nguyên mức giá và tiền cọc ban đầu.
          </div>
        </section>
      )}

      {tab === 2 && (
        <div className="grid12">
          <section className="span7 card col g16">
            <div className="col g2">
              <h2 className="t14 w800 c-ink">Các sân đang tạm khóa bảo trì / ngừng khai thác</h2>
              <span className="t12 c-s600">
                Sân bị khóa sẽ không nhận lịch đặt trong khoảng thời gian bảo trì.
              </span>
            </div>

            {blocksQ.isLoading && (
              <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
                Đang tải danh sách khóa sân...
              </div>
            )}
            {blocksQ.isError && (
              <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
                {extractErrorMessage(blocksQ.error)}
              </div>
            )}
            {!blocksQ.isLoading && blocks.length === 0 && (
              <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
                Hiện không có sân nào đang bảo trì.
              </div>
            )}

            {blocks.map((b) => (
              <div
                key={b.blockId}
                className="row between g12 wrap"
                style={{
                  background: 'var(--amber-50)',
                  border: '2px solid var(--amber-400)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div className="col g2">
                  <b className="t12 c-ink">
                    {b.court.name} ({b.court.code}) • {b.court.branchName}
                  </b>
                  <span className="t12 c-s700">
                    {b.blockType === 'DECOMMISSION' || !b.endAt
                      ? `Từ ${formatDateTimeVn(b.startAt)} • Ngừng khai thác không thời hạn`
                      : `${formatDateTimeVn(b.startAt)} → ${formatDateTimeVn(b.endAt)}`}
                  </span>
                  <span className="t11 c-amber">
                    {b.reason} • Tạo bởi {b.createdByName}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-warn-o btn-sm"
                  disabled={releasingBlockId === b.blockId}
                  onClick={() => void handleReleaseBlock(b.blockId, b.court.name)}
                >
                  {releasingBlockId === b.blockId ? 'Đang mở...' : 'Mở lại sân'}
                </button>
              </div>
            ))}

            <div className="col g8 top-rule" style={{ paddingTop: 12 }}>
              <b className="t12 c-ink">⚠️ Đơn đặt sân bị ảnh hưởng cần xử lý (UC 021)</b>
              <AffectedBookingsModal
                branchId={scopedBranchId}
                emptyText="Chưa có đơn nào bị ảnh hưởng."
              />
            </div>
          </section>

          <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
            <div className="col head-rule" style={{ gap: 2 }}>
              <span className="eyebrow" style={{ color: 'var(--amber-800)' }}>
                Tạm khóa sân
              </span>
              <h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
                Lên lịch bảo trì / ngừng khai thác
              </h3>
            </div>
            <form noValidate className="col g14" onSubmit={(e) => void handleSubmitBlock(e)}>
              <div className="row g8">
                {(
                  [
                    ['MAINTENANCE', 'lock-mode-temp', 'Tạm khóa bảo trì'],
                    ['DECOMMISSION', 'lock-mode-stop', 'Ngừng khai thác'],
                  ] as const
                ).map(([kind, tid, label]) => (
                  <label
                    key={kind}
                    className={`radio-card f1${blockForm.blockType === kind ? ' on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="lockmode"
                      data-testid={tid}
                      checked={blockForm.blockType === kind}
                      onChange={() => setBlockForm((f) => ({ ...f, blockType: kind }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div>
                <label className="label" style={{ marginBottom: 4 }}>
                  Sân cần khóa <span className="req">*</span>
                </label>
                <select
                  className="select sm"
                  value={blockForm.courtId}
                  onChange={(e) => setBlockForm((f) => ({ ...f, courtId: e.target.value }))}
                >
                  <option value="">— Chọn sân —</option>
                  {courts.map((c) => (
                    <option key={c.courtId} value={c.courtId}>
                      {c.name} – {c.branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row g12">
                <div className="f1">
                  <label className="label" style={{ marginBottom: 4 }}>
                    Từ <span className="req">*</span>
                  </label>
                  <input
                    className="input sm"
                    type="datetime-local"
                    value={blockForm.startAt}
                    onChange={(e) => setBlockForm((f) => ({ ...f, startAt: e.target.value }))}
                  />
                </div>
                {blockForm.blockType === 'MAINTENANCE' && (
                  <div className="f1">
                    <label className="label" style={{ marginBottom: 4 }}>
                      Đến <span className="req">*</span>
                    </label>
                    <input
                      className="input sm"
                      type="datetime-local"
                      value={blockForm.endAt}
                      onChange={(e) => setBlockForm((f) => ({ ...f, endAt: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              {blockForm.blockType === 'DECOMMISSION' && (
                <p className="t11 c-s600">
                  Ngừng khai thác không thời hạn cho đến khi Chủ sân mở lại.
                </p>
              )}
              <div>
                <label className="label" style={{ marginBottom: 4 }}>
                  Lý do {blockForm.blockType === 'DECOMMISSION' ? 'ngừng khai thác' : 'bảo trì'}{' '}
                  <span className="req">*</span>
                </label>
                <input
                  className="input sm"
                  style={{ fontWeight: 500 }}
                  value={blockForm.reason}
                  onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
              {blockErr && <p className="field-err">{blockErr}</p>}
              <button type="submit" className="btn btn-danger btn-md" disabled={blockBusy}>
                {blockBusy
                  ? 'Đang kiểm tra...'
                  : blockForm.blockType === 'DECOMMISSION'
                    ? 'Ngừng khai thác sân'
                    : 'Tạm khóa sân'}
              </button>
            </form>
          </aside>
        </div>
      )}

      {tab === 3 && (
        <div className="grid12">
          <section className="span7 card col g16">
            <div className="row between wrap g12">
              <div className="col g2">
                <h2 className="t14 w800 c-ink">Giờ mở cửa theo từng thứ trong tuần</h2>
                <span className="t12 c-s600">
                  Khung giờ này quyết định bảng lịch khách có thể đặt trực tuyến & tại quầy.
                </span>
              </div>
              <select
                className="select sm fit"
                aria-label="Chi nhánh cấu hình giờ"
                disabled={branchFilter !== 'all'}
                value={effectiveHoursBranchId ? String(effectiveHoursBranchId) : ''}
                onChange={(e) => setSelectedHoursBranchId(Number(e.target.value))}
              >
                {branches.map((b) => (
                  <option key={b.branchId} value={b.branchId}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {openingHoursQ.isLoading && (
              <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
                Đang tải giờ mở cửa...
              </div>
            )}

            <div className="col g8">
              {DAYS.map(([dowNum, label]) => {
                const day = hoursDraft.find((d) => d.dayOfWeek === dowNum) ?? {
                  dayOfWeek: dowNum,
                  openTime: '05:00',
                  closeTime: '23:00',
                  isClosed: false,
                };
                return (
                  <div
                    key={dowNum}
                    className="row between g12 wrap hint"
                    style={{ padding: 10, opacity: day.isClosed ? 0.6 : 1 }}
                  >
                    <b className="t12 c-ink" style={{ width: 80 }}>
                      {label}
                    </b>
                    <div className="row g8">
                      <input
                        type="time"
                        className="input sm"
                        style={{ width: 'auto' }}
                        disabled={day.isClosed}
                        value={day.openTime ?? ''}
                        onChange={(e) => setOpeningDay(dowNum, { openTime: e.target.value })}
                      />
                      <span className="t12 c-s600">đến</span>
                      <input
                        type="time"
                        className="input sm"
                        style={{ width: 'auto' }}
                        disabled={day.isClosed}
                        value={day.closeTime ?? ''}
                        onChange={(e) => setOpeningDay(dowNum, { closeTime: e.target.value })}
                      />
                    </div>
                    <label className="row g6 t12 c-s700" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={day.isClosed}
                        onChange={(e) => setOpeningDay(dowNum, { isClosed: e.target.checked })}
                      />
                      Nghỉ cả ngày
                    </label>
                  </div>
                );
              })}
            </div>
            {hoursErr && <p className="field-err">{hoursErr}</p>}
            <div className="row g8 wrap">
              <button
                type="button"
                className="btn btn-primary btn-md"
                disabled={hoursBusy || !effectiveHoursBranchId}
                onClick={() => void handleSaveHours()}
              >
                {hoursBusy ? 'Đang kiểm tra...' : 'Lưu giờ mở cửa'}
              </button>
              <button type="button" className="btn btn-outline btn-md" onClick={applyMondayToAll}>
                Áp dụng giờ Thứ Hai cho cả tuần
              </button>
            </div>
            <div className="col g8 top-rule" style={{ paddingTop: 12 }}>
              <b className="t12 c-ink">Đơn đặt sân bị ảnh hưởng cần xử lý (UC 021)</b>
              <AffectedBookingsModal
                branchId={scopedBranchId}
                emptyText="Không có đơn nào bị ảnh hưởng bởi thay đổi lịch vận hành."
              />
            </div>
          </section>

          <aside className="span5 card card-lg card-raise col g16" style={{ padding: 20 }}>
            <div className="col head-rule" style={{ gap: 2 }}>
              <span className="eyebrow">Lịch nghỉ lễ</span>
              <h3 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
                Ngày đóng cửa (theo khoảng ngày)
              </h3>
            </div>
            <div className="col g8">
              {holidaysQ.isLoading && <p className="t12 c-s600">Đang tải lịch nghỉ lễ...</p>}
              {!holidaysQ.isLoading && holidays.length === 0 && (
                <p className="t12 c-s600">Chưa có ngày nghỉ lễ nào.</p>
              )}
              {holidays.map((h) => (
                <div key={h.holidayId} className="row between g8 hint" style={{ padding: 12 }}>
                  <div className="col g2">
                    <b className="c-ink">
                      {h.startDate === h.endDate
                        ? toVN(h.startDate)
                        : `${toVN(h.startDate)} → ${toVN(h.endDate)}`}
                    </b>
                    <span>{h.reason}</span>
                    <span className="t11 c-s500">
                      {h.branch.name}
                      {h.groupKey ? ` • Nhóm ${h.groupKey}` : ''}
                    </span>
                  </div>
                  <div className="row g6 wrap" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-danger-o btn-xs"
                      disabled={deletingHolidayId === h.holidayId}
                      onClick={() => void handleDeleteHoliday(h, false)}
                    >
                      Xóa
                    </button>
                    {h.groupKey && (
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        disabled={deletingHolidayId === h.holidayId}
                        onClick={() => void handleDeleteHoliday(h, true)}
                      >
                        Xóa cả nhóm
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <form noValidate className="col g10" onSubmit={(e) => void handleAddHoliday(e)}>
              <div className="row g8">
                <input
                  className="input sm"
                  type="date"
                  min={today}
                  value={holidayForm.startDate}
                  aria-label="Từ ngày"
                  onChange={(e) => setHolidayForm((f) => ({ ...f, startDate: e.target.value }))}
                />
                <input
                  className="input sm"
                  type="number"
                  min={1}
                  max={60}
                  style={{ width: 90 }}
                  aria-label="Số ngày nghỉ liên tiếp"
                  title="Số ngày nghỉ liên tiếp"
                  value={holidayForm.days}
                  onChange={(e) =>
                    setHolidayForm((f) => ({ ...f, days: Number(e.target.value) }))
                  }
                />
              </div>
              <p className="t11 c-s600">
                {holidayForm.startDate
                  ? `Nghỉ ${holidayForm.days} ngày liên tiếp: từ ${toVN(holidayForm.startDate)} đến ${toVN(addDays(holidayForm.startDate, Math.max(1, holidayForm.days) - 1))}`
                  : 'Chọn ngày bắt đầu và số ngày nghỉ liên tiếp (khoảng Từ ngày – Đến ngày).'}
              </p>
              <select
                className="select sm"
                aria-label="Phạm vi ngày nghỉ"
                value={holidayForm.scope}
                onChange={(e) =>
                  setHolidayForm((f) => ({ ...f, scope: e.target.value as HolidayScope }))
                }
              >
                <option value="ALL">Toàn hệ thống</option>
                <option value="BRANCH">Theo từng chi nhánh</option>
              </select>
              {holidayForm.scope === 'BRANCH' && (
                <select
                  className="select sm"
                  aria-label="Chi nhánh nghỉ lễ"
                  value={holidayForm.branchId ? String(holidayForm.branchId) : ''}
                  onChange={(e) =>
                    setHolidayForm((f) => ({ ...f, branchId: Number(e.target.value) }))
                  }
                >
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="input sm"
                style={{ fontWeight: 500 }}
                placeholder="Ghi chú (vd: Nghỉ Tết)"
                value={holidayForm.reason}
                onChange={(e) => setHolidayForm((f) => ({ ...f, reason: e.target.value }))}
              />
              {holidayErr && <p className="field-err">{holidayErr}</p>}
              <button type="submit" className="btn btn-primary btn-md" disabled={holidayBusy}>
                {holidayBusy ? 'Đang kiểm tra...' : '+ Thêm ngày nghỉ'}
              </button>
            </form>
          </aside>
        </div>
      )}

      {courtModalOpen && (
        <div className="modal-bg" onClick={() => !courtSaving && setCourtModalOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 680, maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between head-rule">
              <div className="col" style={{ gap: 2 }}>
                <span className="eyebrow">Thông tin sân thi đấu</span>
                <h3 className="t18 w800 c-ink">
                  {editCourtId ? 'Chỉnh sửa sân' : 'Thêm sân mới'}
                </h3>
              </div>
              <span className="badge sq b-gray mono" style={{ fontWeight: 800 }}>
                {courtDetailQ.data?.code ??
                  courts.find((c) => c.courtId === editCourtId)?.code ??
                  'SAN_MỚI'}
              </span>
            </div>

            <form noValidate className="col g14" onSubmit={(e) => void handleSaveCourt(e)}>
              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="f1">
                  <label className="label">
                    Tên sân thi đấu <span className="req">*</span>
                  </label>
                  <input
                    className="input sm"
                    value={courtForm.name}
                    onChange={(e) => setCourtForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="f1">
                  <label className="label">
                    Thuộc chi nhánh <span className="req">*</span>
                  </label>
                  <select
                    className="select sm"
                    disabled={Boolean(editCourtId && courtDetailQ.data?.hasOpenBookings)}
                    value={courtForm.branchId ? String(courtForm.branchId) : ''}
                    onChange={(e) =>
                      setCourtForm((f) => ({ ...f, branchId: Number(e.target.value) }))
                    }
                  >
                    {branches.map((b) => (
                      <option key={b.branchId} value={b.branchId}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {editCourtId && courtDetailQ.data?.hasOpenBookings && (
                    <span className="t11 c-amber">
                      Sân đang có đơn đặt mở, không thể đổi chi nhánh.
                    </span>
                  )}
                </div>
              </div>

              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="f1">
                  <label className="label">
                    Bộ môn thể thao <span className="req">*</span>
                  </label>
                  <select
                    className="select sm"
                    disabled={Boolean(editCourtId)}
                    value={courtForm.sportId ? String(courtForm.sportId) : ''}
                    onChange={(e) =>
                      setCourtForm((f) => ({ ...f, sportId: Number(e.target.value) }))
                    }
                  >
                    {sports.map((s) => (
                      <option key={s.sportId} value={s.sportId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f1">
                  <label className="label">Loại mặt sân / mô hình</label>
                  <input
                    className="input sm"
                    placeholder="VD: Sân mái che, Sân cỏ nhân tạo"
                    value={courtForm.courtType}
                    onChange={(e) => setCourtForm((f) => ({ ...f, courtType: e.target.value }))}
                  />
                </div>
              </div>

              <div className="row g12" style={{ alignItems: 'flex-start' }}>
                <div className="f1">
                  <label className="label">
                    Hình thức đặt cọc <span className="req">*</span>
                  </label>
                  <select
                    className="select sm"
                    value={courtForm.depositType}
                    onChange={(e) => {
                      const next = e.target.value as DepositType;
                      setCourtForm((f) => ({
                        ...f,
                        depositType: next,
                        depositValue: next === 'PERCENT' ? 30 : 100000,
                      }));
                    }}
                  >
                    <option value="PERCENT">Theo tỷ lệ %</option>
                    <option value="FIXED">Số tiền cố định (VNĐ)</option>
                  </select>
                </div>
                <div className="f1">
                  <label className="label">
                    {courtForm.depositType === 'PERCENT'
                      ? 'Tỷ lệ đặt cọc giữ sân (10% – 100%) *'
                      : 'Số tiền đặt cọc cố định (VNĐ) *'}
                  </label>
                  <input
                    data-testid="court-deposit"
                    className="input sm"
                    style={{ color: 'var(--brand-700)', fontWeight: 800 }}
                    type="number"
                    min={courtForm.depositType === 'PERCENT' ? 10 : 1}
                    max={courtForm.depositType === 'PERCENT' ? 100 : undefined}
                    step={courtForm.depositType === 'PERCENT' ? 1 : 1000}
                    value={courtForm.depositValue}
                    onChange={(e) =>
                      setCourtForm((f) => ({ ...f, depositValue: Number(e.target.value) }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="label">Mô tả sân (tối đa 500 ký tự)</label>
                <textarea
                  data-testid="court-desc"
                  className="input sm"
                  rows={2}
                  maxLength={500}
                  style={{ fontWeight: 500 }}
                  value={courtForm.description}
                  onChange={(e) => setCourtForm((f) => ({ ...f, description: e.target.value }))}
                />
                <span className="t11 c-s500">{courtForm.description.length}/500</span>
              </div>

              <div className="col g8">
                <div className="row between">
                  <label className="label" style={{ margin: 0 }}>
                    Bảng giá thuê theo khung giờ (VNĐ/giờ) <span className="req">*</span>
                  </label>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      setCourtForm((f) => ({
                        ...f,
                        priceRules: [
                          ...f.priceRules,
                          {
                            label: 'Khung mới',
                            dayOfWeekMask: 127,
                            startTime: '05:00',
                            endTime: '06:00',
                            pricePerHour: 100000,
                          },
                        ],
                      }))
                    }
                  >
                    + Thêm khung giá
                  </button>
                </div>
                <div
                  className="col g8"
                  style={{
                    background: 'var(--s100)',
                    border: '1px solid var(--s300)',
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  {courtForm.priceRules.map((r, i) => (
                    <div key={i} className="row g6 wrap" style={{ alignItems: 'center' }}>
                      <input
                        className="input sm"
                        style={{ width: 110 }}
                        value={r.label}
                        aria-label={`Tên khung giá ${i + 1}`}
                        onChange={(e) => setRuleField(i, { label: e.target.value })}
                      />
                      <select
                        className="select sm"
                        style={{ width: 135 }}
                        aria-label={`Ngày áp dụng khung ${i + 1}`}
                        value={String(r.dayOfWeekMask)}
                        onChange={(e) =>
                          setRuleField(i, { dayOfWeekMask: Number(e.target.value) })
                        }
                      >
                        {MASK_OPTIONS.map(([m, label]) => (
                          <option key={m} value={m}>
                            {label}
                          </option>
                        ))}
                        {!MASK_OPTIONS.some(([m]) => m === r.dayOfWeekMask) && (
                          <option value={r.dayOfWeekMask}>{maskLabel(r.dayOfWeekMask)}</option>
                        )}
                      </select>
                      <input
                        className="input sm"
                        style={{ width: 90 }}
                        type="time"
                        aria-label={`Giờ bắt đầu khung ${i + 1}`}
                        value={r.startTime}
                        onChange={(e) => setRuleField(i, { startTime: e.target.value })}
                      />
                      <input
                        className="input sm"
                        style={{ width: 90 }}
                        type="time"
                        aria-label={`Giờ kết thúc khung ${i + 1}`}
                        value={r.endTime}
                        onChange={(e) => setRuleField(i, { endTime: e.target.value })}
                      />
                      <input
                        className="input sm bold"
                        style={{ width: 110 }}
                        type="number"
                        min={0}
                        step={1000}
                        aria-label={`Đơn giá khung ${i + 1}`}
                        value={r.pricePerHour}
                        onChange={(e) =>
                          setRuleField(i, { pricePerHour: Number(e.target.value) })
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-danger-o btn-xs"
                        aria-label={`Xóa khung giá ${i + 1}`}
                        onClick={() =>
                          setCourtForm((f) => ({
                            ...f,
                            priceRules: f.priceRules.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Trạng thái nhận lịch</label>
                <select
                  className="select sm"
                  value={courtForm.status}
                  onChange={(e) =>
                    setCourtForm((f) => ({ ...f, status: e.target.value as CourtStatus }))
                  }
                >
                  <option value="ACTIVE">Đang hoạt động</option>
                  <option value="INACTIVE">Ngừng hoạt động</option>
                </select>
              </div>

              {courtErr && <p className="field-err">{courtErr}</p>}

              <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-md"
                  disabled={courtSaving}
                  onClick={() => setCourtModalOpen(false)}
                >
                  Đóng
                </button>
                <button type="submit" className="btn btn-primary btn-md" disabled={courtSaving}>
                  {courtSaving ? 'Đang lưu...' : 'Lưu thông tin sân'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dryRunConfirm && (
        <div className="modal-bg" onClick={() => !confirmBusy && setDryRunConfirm(null)}>
          <div
            className="modal"
            style={{ maxWidth: 560, maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="t18 w800 c-ink">{dryRunConfirm.title}</h3>
            <div
              className="hint"
              style={{
                background: 'var(--amber-50)',
                borderColor: 'var(--amber-400)',
                color: 'var(--amber-950)',
              }}
            >
              Thao tác này sẽ ảnh hưởng đến <b>{dryRunConfirm.affectedCount} đơn đặt sân</b> hiện
              có. Bạn có chắc chắn muốn tiếp tục lưu thay đổi?
            </div>
            <div className="col g8" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {dryRunConfirm.affectedBookings.map((b) => (
                <div
                  key={b.bookingCode}
                  className="row between g8 t12"
                  style={{ border: '1px solid var(--s300)', borderRadius: 10, padding: 10 }}
                >
                  <div className="col">
                    <b className="mono c-ink">
                      #{b.bookingCode} • {b.customerName}
                    </b>
                    <span className="c-s600">
                      {b.courtName} • {toVN(b.date)} ({b.startTime}–{b.endTime})
                    </span>
                  </div>
                  <span className="badge b-amber">{b.customerPhone}</span>
                </div>
              ))}
            </div>
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={confirmBusy}
                onClick={() => setDryRunConfirm(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-danger btn-md"
                disabled={confirmBusy}
                onClick={() => void handleConfirmDryRun()}
              >
                {confirmBusy ? 'Đang lưu...' : 'Xác nhận áp dụng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
