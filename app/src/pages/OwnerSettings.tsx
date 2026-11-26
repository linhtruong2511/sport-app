import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  SYSTEM_SETTING_DEFS,
  SYSTEM_SETTING_GROUPS,
  SYSTEM_SETTING_GROUP_DESCRIPTIONS,
  SYSTEM_SETTING_GROUP_LABELS,
  VIETQR_BANKS,
  type SystemSettingDto,
  type SystemSettingKey,
  validateSettingsCrossRules,
} from '@sporthub/shared';
import {
  createBranch,
  invalidateBranchQueries,
  setBranchActive,
  updateBranch,
  useAdminBranches,
  type AdminBranch,
  type BranchFormInput,
} from '../api/adminBranches.ts';
import { adminSettingKeys, updateAdminSettings, useAdminSettings } from '../api/adminSettings.ts';
import { ApiError } from '../api/client.ts';
import { queryClient } from '../api/queryClient.ts';
import { useToast } from '../ui/toastContext.ts';
import { extractErrorMessage, formatDateTimeVn } from '../utils/format.ts';

type Tab = 'branches' | 'settings';

/** Gom lỗi trường từ `error.details[].field` (bỏ tiền tố như `values.`). */
function fieldErrorsOf(err: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (err instanceof ApiError && Array.isArray(err.details)) {
    for (const d of err.details) {
      if (d.field && !out[d.field.replace(prefix, '')]) {
        out[d.field.replace(prefix, '')] = d.message;
      }
    }
  }
  return out;
}

export default function OwnerSettings() {
  const [tab, setTab] = useState<Tab>('branches');
  const tabs: [Tab, string][] = [
    ['branches', 'Cơ sở & Tài khoản nhận tiền'],
    ['settings', 'Tham số hệ thống'],
  ];

  return (
    <>
      <section className="card row g8 wrap" style={{ padding: 16 }}>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            type="button"
            data-testid={`settings-tab-${t}`}
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
      </section>
      {tab === 'branches' ? <BranchesTab /> : <SettingsTab />}
    </>
  );
}

/* ============================== Tab: Cơ sở ============================== */

const OTHER_BANK = 'OTHER';

const EMPTY_FORM: BranchFormInput = {
  code: '',
  name: '',
  address: '',
  phone: '',
  description: '',
  bankBin: '',
  bankName: '',
  bankAccountNo: '',
  bankAccountName: '',
};

function bankChoiceOf(bin: string | null): string {
  if (!bin) return '';
  return VIETQR_BANKS.some((b) => b.bin === bin) ? bin : OTHER_BANK;
}

function BranchesTab() {
  const { toast } = useToast();
  const branchesQ = useAdminBranches();
  const list = branchesQ.data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBranch | null>(null);
  const [form, setForm] = useState<BranchFormInput>(EMPTY_FORM);
  const [bankChoice, setBankChoice] = useState('');
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<AdminBranch | null>(null);
  const [toggling, setToggling] = useState(false);

  const activeCount = list.filter((b) => b.status === 'ACTIVE').length;

  const setField = (k: keyof BranchFormInput, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErr((e) => {
      if (!e[k]) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setBankChoice('');
    setFieldErr({});
    setFormErr('');
    setModalOpen(true);
  };

  const openEdit = (b: AdminBranch) => {
    setEditing(b);
    setForm({
      code: b.code,
      name: b.name,
      address: b.address,
      phone: b.phone ?? '',
      description: b.description ?? '',
      bankBin: b.bankBin ?? '',
      bankName: b.bankName ?? '',
      bankAccountNo: b.bankAccountNo ?? '',
      bankAccountName: b.bankAccountName ?? '',
    });
    setBankChoice(bankChoiceOf(b.bankBin));
    setFieldErr({});
    setFormErr('');
    setModalOpen(true);
  };

  const onBankChoice = (choice: string) => {
    setBankChoice(choice);
    if (choice === '') {
      setForm((f) => ({ ...f, bankBin: '', bankName: '', bankAccountNo: '', bankAccountName: '' }));
    } else if (choice === OTHER_BANK) {
      setForm((f) => ({ ...f, bankBin: '', bankName: '' }));
    } else {
      const bank = VIETQR_BANKS.find((b) => b.bin === choice);
      setForm((f) => ({ ...f, bankBin: choice, bankName: bank?.shortName ?? '' }));
    }
    setFieldErr((e) => {
      const next = { ...e };
      delete next.bankBin;
      delete next.bankName;
      return next;
    });
  };

  const accountChanged =
    editing !== null && (form.bankAccountNo ?? '').replace(/\s+/g, '') !== (editing.bankAccountNo ?? '');
  const showPendingQrWarning = accountChanged && (editing?.pendingPaymentRequestCount ?? 0) > 0;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setFormErr('');
    setFieldErr({});
    setSaving(true);
    try {
      if (editing) {
        // EXT-03: mã cơ sở bất biến — không gửi `code`.
        const saved = await updateBranch(editing.branchId, {
          name: form.name,
          address: form.address,
          phone: form.phone,
          description: form.description,
          bankBin: form.bankBin,
          bankName: form.bankName,
          bankAccountNo: form.bankAccountNo,
          bankAccountName: form.bankAccountName,
        });
        toast(`Đã cập nhật cơ sở ${saved.name}.`, 'ok');
      } else {
        const saved = await createBranch(form);
        toast(
          `Đã thêm cơ sở ${saved.code}. Giờ mở cửa mặc định 06:00–22:00 hằng ngày — chỉnh tại Quản lý sân bãi.`,
          'ok',
        );
      }
      await invalidateBranchQueries();
      setModalOpen(false);
    } catch (err) {
      const fe = fieldErrorsOf(err);
      setFieldErr(fe);
      if (err instanceof ApiError && err.code === 'BRANCH_BANK_ACCOUNT_DUPLICATE') {
        setFieldErr((x) => ({ ...x, bankAccountNo: err.message }));
      } else if (err instanceof ApiError && err.code === 'BRANCH_CODE_DUPLICATE') {
        setFieldErr((x) => ({ ...x, code: err.message }));
      } else if (Object.keys(fe).length === 0) {
        setFormErr(extractErrorMessage(err));
      } else {
        setFormErr('Vui lòng kiểm tra lại các trường được đánh dấu.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!confirmTarget) return;
    const activate = confirmTarget.status !== 'ACTIVE';
    setToggling(true);
    try {
      const saved = await setBranchActive(confirmTarget.branchId, activate);
      toast(
        activate
          ? `Đã mở lại cơ sở ${saved.name}.`
          : `Đã ngừng hoạt động cơ sở ${saved.name}. Khách không còn thấy cơ sở này khi đặt sân.`,
        'ok',
      );
      await invalidateBranchQueries();
      setConfirmTarget(null);
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setToggling(false);
    }
  };

  const err = (k: string) => (fieldErr[k] ? <p className="field-err">{fieldErr[k]}</p> : null);

  return (
    <>
      <section className="card col g16">
        <div className="row between wrap g12">
          <div className="col" style={{ gap: 4 }}>
            <h2 className="t14 w800 c-ink">Danh sách cơ sở</h2>
            <span className="t12 c-s600">
              {activeCount} đang hoạt động • {list.length - activeCount} ngừng hoạt động
            </span>
          </div>
          <button
            type="button"
            data-testid="branch-create"
            className="btn btn-primary btn-md"
            style={{ padding: '8px 16px' }}
            onClick={openCreate}
          >
            + Thêm cơ sở mới
          </button>
        </div>

        {branchesQ.isError && (
          <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
            {extractErrorMessage(branchesQ.error, 'Không thể tải danh sách cơ sở.')}
          </div>
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mã / Tên cơ sở</th>
                <th>Địa chỉ / Liên hệ</th>
                <th>Tài khoản nhận chuyển khoản</th>
                <th>Quy mô</th>
                <th>Trạng thái</th>
                <th className="r">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {branchesQ.isLoading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>
                    Đang tải danh sách cơ sở...
                  </td>
                </tr>
              )}
              {!branchesQ.isLoading && !branchesQ.isError && list.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>
                    Chưa có cơ sở nào.
                  </td>
                </tr>
              )}
              {list.map((b) => {
                const inactive = b.status !== 'ACTIVE';
                return (
                  <tr key={b.branchId} className={inactive ? 'dim' : ''} data-testid={`branch-row-${b.code}`}>
                    <td>
                      <div className="mono w800" style={{ fontSize: 10.5 }}>
                        {b.code}
                      </div>
                      <div className="w700">{b.name}</div>
                    </td>
                    <td>
                      <div>{b.address}</div>
                      <div className="mono c-s600" style={{ fontSize: 11 }}>
                        {b.phone ?? '—'}
                      </div>
                    </td>
                    <td>
                      {b.bankAccountNo ? (
                        <>
                          <div className="w700">{b.bankName}</div>
                          <div className="mono w700" style={{ fontSize: 11 }}>
                            {b.bankAccountNo}
                          </div>
                          <div className="c-s600" style={{ fontSize: 11 }}>
                            {b.bankAccountName}
                          </div>
                        </>
                      ) : (
                        <span className="badge b-amber">Chưa cấu hình — khách không thanh toán QR được</span>
                      )}
                    </td>
                    <td>
                      <div className="w700">{b.courtCount} sân</div>
                      <div className="c-s600">
                        {b.activeStaffCount} nhân viên • {b.activeBookingCount} đơn hiệu lực
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${inactive ? 'b-gray' : 'b-green'}`}>
                        {inactive ? 'Ngừng hoạt động' : 'Đang hoạt động'}
                      </span>
                    </td>
                    <td className="r">
                      <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '6px 10px', color: 'var(--s800)' }}
                          onClick={() => openEdit(b)}
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${inactive ? 'btn-green-o' : 'btn-danger-o'}`}
                          style={{ padding: '6px 10px' }}
                          onClick={() => setConfirmTarget(b)}
                        >
                          {inactive ? 'Mở lại' : 'Ngừng'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="hint" style={{ lineHeight: '16px' }}>
          🏦 Số tài khoản của mỗi cơ sở dùng để tạo mã QR thanh toán và tự đối chiếu tiền khách chuyển, vì vậy
          hai cơ sở không được dùng chung một số tài khoản. Giờ mở cửa, ngày nghỉ và danh sách sân chỉnh tại{' '}
          <Link to="/owner/courts" className="link-btn">
            Quản lý sân bãi
          </Link>
          .
        </div>
      </section>

      {modalOpen && (
        <div className="modal-bg" onClick={() => !saving && setModalOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="col head-rule" style={{ gap: 4 }}>
              <span className="eyebrow">Thông tin cơ sở</span>
              <h3 className="t18 w800 c-ink">
                {editing ? `Chỉnh sửa cơ sở ${editing.code}` : 'Thêm cơ sở mới'}
              </h3>
            </div>
            <form noValidate className="col g14" onSubmit={(e) => void handleSave(e)}>
              <div
                style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) 3fr', gap: 12 }}
              >
                <div>
                  <label className="label">
                    Mã cơ sở <span className="req">*</span>
                  </label>
                  <input
                    data-testid="branch-code"
                    className="input sm bold mono"
                    placeholder="CS03"
                    disabled={editing !== null}
                    value={form.code ?? ''}
                    onChange={(e) => setField('code', e.target.value.toUpperCase())}
                  />
                  {err('code')}
                </div>
                <div>
                  <label className="label">
                    Tên cơ sở <span className="req">*</span>
                  </label>
                  <input
                    data-testid="branch-name"
                    className="input sm"
                    placeholder="Cơ sở 3 - Long Biên"
                    value={form.name ?? ''}
                    onChange={(e) => setField('name', e.target.value)}
                  />
                  {err('name')}
                </div>
              </div>
              <div>
                <label className="label">
                  Địa chỉ <span className="req">*</span>
                </label>
                <input
                  data-testid="branch-address"
                  className="input sm"
                  value={form.address ?? ''}
                  onChange={(e) => setField('address', e.target.value)}
                />
                {err('address')}
              </div>
              <div>
                <label className="label">Số điện thoại cơ sở</label>
                <input
                  className="input sm mono"
                  inputMode="tel"
                  value={form.phone ?? ''}
                  onChange={(e) => setField('phone', e.target.value)}
                />
                {err('phone')}
              </div>
              <div>
                <label className="label">Mô tả (tiện ích, loại sân…)</label>
                <textarea
                  className="input sm"
                  rows={2}
                  style={{ resize: 'vertical', fontWeight: 500 }}
                  value={form.description ?? ''}
                  onChange={(e) => setField('description', e.target.value)}
                />
                {err('description')}
              </div>

              <div className="col g12 card" style={{ padding: 14, background: 'var(--s50)' }}>
                <span className="t12 w800 c-ink">Tài khoản nhận chuyển khoản (VietQR)</span>
                <div>
                  <label className="label">Ngân hàng</label>
                  <select
                    data-testid="branch-bank"
                    className="select sm"
                    value={bankChoice}
                    onChange={(e) => onBankChoice(e.target.value)}
                  >
                    <option value="">— Chưa cấu hình —</option>
                    {VIETQR_BANKS.map((b) => (
                      <option key={b.bin} value={b.bin}>
                        {b.shortName} — {b.name}
                      </option>
                    ))}
                    <option value={OTHER_BANK}>Ngân hàng khác (nhập mã BIN)</option>
                  </select>
                  {bankChoice !== OTHER_BANK && (err('bankBin') ?? err('bankName'))}
                </div>
                {bankChoice === OTHER_BANK && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
                    <div>
                      <label className="label">
                        Mã BIN <span className="req">*</span>
                      </label>
                      <input
                        className="input sm mono"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="970xxx"
                        value={form.bankBin ?? ''}
                        onChange={(e) => setField('bankBin', e.target.value)}
                      />
                      {err('bankBin')}
                    </div>
                    <div>
                      <label className="label">
                        Tên ngân hàng <span className="req">*</span>
                      </label>
                      <input
                        className="input sm"
                        value={form.bankName ?? ''}
                        onChange={(e) => setField('bankName', e.target.value)}
                      />
                      {err('bankName')}
                    </div>
                  </div>
                )}
                {bankChoice !== '' && (
                  <>
                    <div>
                      <label className="label">
                        Số tài khoản <span className="req">*</span>
                      </label>
                      <input
                        data-testid="branch-account-no"
                        className="input sm bold mono"
                        inputMode="numeric"
                        value={form.bankAccountNo ?? ''}
                        onChange={(e) => setField('bankAccountNo', e.target.value)}
                      />
                      {err('bankAccountNo')}
                    </div>
                    <div>
                      <label className="label">
                        Tên chủ tài khoản <span className="req">*</span>
                      </label>
                      <input
                        data-testid="branch-account-name"
                        className="input sm"
                        placeholder="CONG TY SPORTHUB CS3"
                        style={{ textTransform: 'uppercase' }}
                        value={form.bankAccountName ?? ''}
                        onChange={(e) => setField('bankAccountName', e.target.value)}
                      />
                      {err('bankAccountName')}
                    </div>
                  </>
                )}
                {showPendingQrWarning && (
                  <div
                    className="hint"
                    style={{ background: 'var(--amber-50)', color: 'var(--amber-900)', lineHeight: '16px' }}
                  >
                    ⚠ Cơ sở đang có {editing?.pendingPaymentRequestCount} mã QR chưa hết hạn sinh theo số tài
                    khoản cũ. Nếu khách vẫn chuyển vào tài khoản cũ, giao dịch sẽ không tự xác nhận mà chuyển
                    sang màn Đối soát & Hoàn tiền để xử lý thủ công.
                  </div>
                )}
              </div>

              {!editing && (
                <p className="t12 c-s600">
                  Cơ sở mới được tạo ở trạng thái Đang hoạt động với giờ mở cửa mặc định 06:00–22:00 hằng
                  ngày. Hãy thêm sân và chỉnh giờ mở cửa trước khi nhận đơn.
                </p>
              )}
              {formErr && <p className="field-err">{formErr}</p>}
              <div className="row g8" style={{ justifyContent: 'flex-end', paddingTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-md"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  data-testid="branch-save"
                  className="btn btn-primary btn-md"
                  disabled={saving}
                >
                  {saving ? 'Đang lưu...' : 'Lưu cơ sở'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmTarget && (
        <div className="modal-bg" onClick={() => !toggling && setConfirmTarget(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="col head-rule" style={{ gap: 4 }}>
              <span className="eyebrow">Xác nhận</span>
              <h3 className="t18 w800 c-ink">
                {confirmTarget.status === 'ACTIVE'
                  ? `Ngừng hoạt động ${confirmTarget.name}?`
                  : `Mở lại ${confirmTarget.name}?`}
              </h3>
            </div>
            <p className="t12 c-s600" style={{ lineHeight: '18px' }}>
              {confirmTarget.status === 'ACTIVE'
                ? confirmTarget.activeBookingCount > 0
                  ? `Cơ sở đang có ${confirmTarget.activeBookingCount} đơn còn hiệu lực. Hệ thống sẽ từ chối ngừng hoạt động cho tới khi các đơn này được xử lý xong.`
                  : 'Khách sẽ không còn thấy cơ sở này khi tìm và đặt sân. Lịch sử đơn, doanh thu và tài khoản nhân viên vẫn được giữ nguyên.'
                : 'Cơ sở sẽ hiển thị lại cho khách và nhận đơn đặt sân mới.'}
            </p>
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={toggling}
                onClick={() => setConfirmTarget(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                data-testid="branch-toggle-confirm"
                className={`btn btn-md ${confirmTarget.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'}`}
                disabled={toggling}
                onClick={() => void handleToggle()}
              >
                {toggling
                  ? 'Đang xử lý...'
                  : confirmTarget.status === 'ACTIVE'
                    ? 'Ngừng hoạt động'
                    : 'Mở lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================ Tab: Tham số ============================ */

function SettingsTab() {
  const settingsQ = useAdminSettings();

  if (settingsQ.isLoading) {
    return (
      <section className="card center" style={{ padding: 32 }}>
        <span className="t12 c-s600">Đang tải tham số hệ thống...</span>
      </section>
    );
  }
  if (settingsQ.isError || !settingsQ.data) {
    return (
      <section className="card">
        <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
          {extractErrorMessage(settingsQ.error, 'Không thể tải tham số hệ thống.')}
        </div>
      </section>
    );
  }
  // Mỗi lần dữ liệu server đổi (tải lại / vừa lưu) thì dựng lại form từ giá trị mới.
  return <SettingsForm key={settingsQ.dataUpdatedAt} settings={settingsQ.data} />;
}

function toDraft(settings: SystemSettingDto[]): Record<string, string> {
  return Object.fromEntries(settings.map((s) => [s.key, String(s.value)]));
}

function SettingsForm({ settings }: { settings: SystemSettingDto[] }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(settings));
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const serverValues = useMemo(
    () => new Map<string, number>(settings.map((s) => [s.key, s.value])),
    [settings],
  );

  const lastUpdated = useMemo(() => {
    const times = settings.map((s) => s.updatedAt).sort();
    return times.length > 0 ? times[times.length - 1] : null;
  }, [settings]);

  const changed = useMemo(() => {
    const out: Partial<Record<SystemSettingKey, number>> = {};
    for (const def of SYSTEM_SETTING_DEFS) {
      const raw = (draft[def.key] ?? '').trim();
      if (raw === '' || !serverValues.has(def.key)) continue;
      const n = Number(raw);
      if (n !== serverValues.get(def.key)) out[def.key] = n;
    }
    return out;
  }, [draft, serverValues]);
  const changedCount = Object.keys(changed).length;

  // Kiểm tra sớm để báo ngay trên ô nhập; server vẫn là nơi kiểm tra cuối (EXT-06).
  const validateLocal = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const merged: Partial<Record<SystemSettingKey, number>> = {};
    for (const def of SYSTEM_SETTING_DEFS) {
      const raw = (draft[def.key] ?? '').trim();
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < def.min || n > def.max) {
        errs[def.key] = `Nhập số nguyên từ ${def.min} đến ${def.max} ${def.unit}.`;
      } else {
        merged[def.key] = n;
      }
    }
    for (const v of validateSettingsCrossRules(merged)) {
      errs[v.field] ??= v.message;
    }
    return errs;
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateLocal();
    setFieldErr(errs);
    if (Object.keys(errs).length > 0 || changedCount === 0) return;

    setSaving(true);
    try {
      const saved = await updateAdminSettings(changed);
      queryClient.setQueryData(adminSettingKeys.all, saved);
      toast(`Đã lưu ${changedCount} tham số. Thay đổi có hiệu lực ngay.`, 'ok');
    } catch (err) {
      const fe = fieldErrorsOf(err, 'values.');
      setFieldErr(fe);
      if (Object.keys(fe).length === 0) toast(extractErrorMessage(err), 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(toDraft(settings));
    setFieldErr({});
  };

  return (
    <form noValidate className="col g16" onSubmit={(e) => void handleSave(e)}>
      <section className="card col" style={{ padding: 0, gap: 0 }}>
        {SYSTEM_SETTING_GROUPS.map((group, gi) => (
          <div
            key={group}
            className="col g16"
            style={{
              padding: '20px 24px',
              borderTop: gi === 0 ? undefined : '1px solid var(--s200)',
            }}
          >
            <div className="col" style={{ gap: 2 }}>
              <h2 className="t14 w800 c-ink">{SYSTEM_SETTING_GROUP_LABELS[group]}</h2>
              <span className="t12 c-s600">{SYSTEM_SETTING_GROUP_DESCRIPTIONS[group]}</span>
            </div>
            <div className="col" style={{ gap: 0 }}>
              {SYSTEM_SETTING_DEFS.filter((d) => d.group === group).map((def, i) => {
                const isChanged = def.key in changed;
                return (
                  <div
                    key={def.key}
                    className="row between g16 wrap"
                    style={{
                      alignItems: 'flex-start',
                      padding: '14px 0',
                      borderTop: i === 0 ? undefined : '1px dashed var(--s200)',
                    }}
                  >
                    <div className="col" style={{ gap: 4, flex: '1 1 320px', maxWidth: 620 }}>
                      <label className="label" style={{ margin: 0 }} htmlFor={`setting-${def.key}`}>
                        {def.label}
                      </label>
                      <span className="t12 c-s600" style={{ lineHeight: '16px' }}>
                        {def.hint}
                      </span>
                    </div>
                    <div className="col" style={{ gap: 4, alignItems: 'flex-end', minWidth: 170 }}>
                      <div className="row g8" style={{ alignItems: 'center' }}>
                        <input
                          id={`setting-${def.key}`}
                          data-testid={`setting-${def.key}`}
                          className="input sm bold mono"
                          type="number"
                          inputMode="numeric"
                          min={def.min}
                          max={def.max}
                          step={1}
                          style={{
                            width: 100,
                            textAlign: 'right',
                            borderColor: isChanged ? 'var(--brand-400)' : undefined,
                          }}
                          value={draft[def.key] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraft((d) => ({ ...d, [def.key]: v }));
                            setFieldErr((x) => {
                              if (!x[def.key]) return x;
                              const next = { ...x };
                              delete next[def.key];
                              return next;
                            });
                          }}
                        />
                        <span className="t12 w700 c-s600" style={{ minWidth: 32 }}>
                          {def.unit}
                        </span>
                      </div>
                      <span className="t12 c-s600">
                        Từ {def.min} đến {def.max} {def.unit}
                      </span>
                      {fieldErr[def.key] && (
                        <p className="field-err" style={{ textAlign: 'right' }}>
                          {fieldErr[def.key]}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section
        className="card row between wrap g12"
        style={{ padding: 16, position: 'sticky', bottom: 12, zIndex: 5, boxShadow: 'var(--shadow-md)' }}
      >
        <span className="t12 c-s600">
          {lastUpdated ? `Cập nhật gần nhất: ${formatDateTimeVn(lastUpdated)}. ` : ''}
          Thay đổi có hiệu lực ngay sau khi lưu. Đơn đã đặt trước đó vẫn giữ thời gian giữ chỗ cũ.
        </span>
        <div className="row g8">
          <button
            type="button"
            className="btn btn-outline btn-md"
            disabled={saving || changedCount === 0}
            onClick={handleReset}
          >
            Hoàn tác
          </button>
          <button
            type="submit"
            data-testid="settings-save"
            className="btn btn-primary btn-md"
            disabled={saving || changedCount === 0}
          >
            {saving ? 'Đang lưu...' : changedCount > 0 ? `Lưu ${changedCount} thay đổi` : 'Lưu thay đổi'}
          </button>
        </div>
      </section>
    </form>
  );
}
