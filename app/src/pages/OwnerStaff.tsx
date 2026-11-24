import { useState } from 'react';
import type { FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { PaymentMethod, PaymentPurpose, UserStatus } from '@sporthub/shared';
import {
  adminStaffKeys,
  createStaff,
  lockStaff,
  unlockStaff,
  updateStaff,
  useAdminStaff,
  useStaffPayments,
  type AdminStaffItem,
} from '../api/adminStaff.ts';
import { queryClient } from '../api/queryClient.ts';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import { addDays, extractErrorMessage, formatDateTimeVn, todayVn, vnd } from '../utils/format.ts';

const PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  DEPOSIT: 'Thu cọc',
  FULL: 'Thu đủ',
  REMAINING: 'Tất toán',
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'VietQR',
  CASH: 'Tiền mặt',
};

interface StaffFormState {
  fullName: string;
  phone: string;
  email: string;
  branchId: number;
  password: string;
  status: UserStatus;
}

export default function OwnerStaff() {
  const { branchFilter, setBranchFilter, branches } = useOutletContext<StaffOutlet>();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | UserStatus>('ALL');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<AdminStaffItem | null>(null);
  const [form, setForm] = useState<StaffFormState>({
    fullName: '',
    phone: '',
    email: '',
    branchId: 0,
    password: '',
    status: 'ACTIVE',
  });
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [historyStaff, setHistoryStaff] = useState<AdminStaffItem | null>(null);
  const [payFrom, setPayFrom] = useState(() => addDays(todayVn(), -29));
  const [payTo, setPayTo] = useState(() => todayVn());
  const [payPage, setPayPage] = useState(1);

  const staffQ = useAdminStaff({
    branchId: branchFilter === 'all' ? undefined : branchFilter,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    q: search.trim() || undefined,
    page,
  });

  const paymentsQ = useStaffPayments(
    historyStaff?.userId,
    {
      from: payFrom || undefined,
      to: payTo || undefined,
      page: payPage,
    },
    { enabled: Boolean(historyStaff) },
  );

  const list = staffQ.data?.data ?? [];
  const meta = staffQ.data?.meta;
  const activeCount = meta?.activeCount ?? 0;
  const lockedCount = meta?.lockedCount ?? 0;
  const countByBranch = meta?.countByBranch ?? {};
  const totalPages = meta?.totalPages ?? 1;

  const defaultBranchId =
    branchFilter !== 'all' ? branchFilter : (branches[0]?.branchId ?? 0);

  const openCreateModal = () => {
    setEditingStaff(null);
    setForm({
      fullName: '',
      phone: '',
      email: '',
      branchId: defaultBranchId,
      password: '',
      status: 'ACTIVE',
    });
    setFormErr('');
    setModalOpen(true);
  };

  const openEditModal = (s: AdminStaffItem) => {
    setEditingStaff(s);
    setForm({
      fullName: s.fullName,
      phone: s.phone,
      email: s.email ?? '',
      branchId: s.branch.branchId,
      password: '',
      status: s.status,
    });
    setFormErr('');
    setModalOpen(true);
  };

  const openHistoryModal = (s: AdminStaffItem) => {
    setHistoryStaff(s);
    setPayFrom(addDays(todayVn(), -29));
    setPayTo(todayVn());
    setPayPage(1);
  };

  const handleToggleLock = async (s: AdminStaffItem) => {
    setTogglingId(s.userId);
    try {
      if (s.status === 'LOCKED') {
        await unlockStaff(s.userId);
        toast(`Đã mở khóa tài khoản ${s.fullName}.`, 'ok');
      } else {
        await lockStaff(s.userId);
        toast(
          `Đã khóa tài khoản ${s.fullName}. Tài khoản không thể đăng nhập nhưng lịch sử giao dịch vẫn được lưu giữ.`,
          'ok',
        );
      }
      await queryClient.invalidateQueries({ queryKey: adminStaffKeys.all });
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setTogglingId(null);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const fullName = form.fullName.trim();
    const phone = form.phone.trim();
    const email = form.email.trim();
    const password = form.password;

    if (!/^[\p{L}\s]{2,100}$/u.test(fullName)) {
      setFormErr('Họ và tên phải từ 2–100 ký tự, chỉ gồm chữ cái và khoảng trắng.');
      return;
    }
    if (!/^0\d{9}$/.test(phone)) {
      setFormErr('Số điện thoại đăng nhập phải gồm 10 chữ số và bắt đầu bằng 0.');
      return;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setFormErr('Địa chỉ email không hợp lệ.');
      return;
    }
    if (!form.branchId || form.branchId <= 0) {
      setFormErr('Vui lòng chọn chi nhánh phân công.');
      return;
    }
    if (!editingStaff) {
      if (!/^(?=.*[A-Za-z])(?=.*\d)\S{8,32}$/.test(password)) {
        setFormErr('Mật khẩu phải từ 8–32 ký tự, không chứa khoảng trắng, gồm ít nhất 1 chữ cái và 1 chữ số.');
        return;
      }
    } else if (password.length > 0 && !/^(?=.*[A-Za-z])(?=.*\d)\S{8,32}$/.test(password)) {
      setFormErr('Mật khẩu mới phải từ 8–32 ký tự, không chứa khoảng trắng, gồm ít nhất 1 chữ cái và 1 chữ số.');
      return;
    }

    setFormErr('');
    setSaving(true);
    try {
      if (editingStaff) {
        await updateStaff(editingStaff.userId, {
          fullName,
          phone,
          email: email || null,
          branchId: form.branchId,
          password: password || undefined,
          status: form.status,
        });
        toast(`Đã cập nhật thông tin ${fullName}.`, 'ok');
      } else {
        const created = await createStaff({
          fullName,
          phone,
          email: email || null,
          branchId: form.branchId,
          password,
          status: form.status,
        });
        toast(`Đã cấp tài khoản ${created.code} cho ${created.fullName}.`, 'ok');
      }
      await queryClient.invalidateQueries({ queryKey: adminStaffKeys.all });
      setModalOpen(false);
    } catch (err) {
      setFormErr(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const payments = paymentsQ.data?.data ?? [];
  const paymentsMeta = paymentsQ.data?.meta;

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g12 wrap">
          <span className="t12 w700 c-s700">Lọc theo chi nhánh:</span>
          <select
            className="select sm bold fit"
            style={{ background: 'var(--s50)', padding: '8px 30px 8px 18px', borderRadius: 12 }}
            value={branchFilter === 'all' ? 'all' : String(branchFilter)}
            onChange={(e) => {
              const v = e.target.value;
              setBranchFilter(v === 'all' ? 'all' : Number(v));
              setPage(1);
            }}
          >
            <option value="all">
              Tất cả chi nhánh ({activeCount + lockedCount} nhân sự)
            </option>
            {branches.map((b) => {
              const bCount = countByBranch[String(b.branchId)];
              return (
                <option key={b.branchId} value={b.branchId}>
                  {b.name.replace(' - ', ' – ')}
                  {typeof bCount === 'number' ? ` (${bCount} nhân sự)` : ''}
                </option>
              );
            })}
          </select>
          <input
            data-testid="staff-search"
            className="input sm"
            style={{ width: 220, background: 'var(--s50)', borderRadius: 12 }}
            placeholder="Tìm theo tên, SĐT, email, mã NV"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            data-testid="staff-status-filter"
            className="select sm fit"
            style={{ background: 'var(--s50)', borderRadius: 12 }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'ALL' | UserStatus);
              setPage(1);
            }}
          >
            <option value="ALL">Mọi trạng thái</option>
            <option value="ACTIVE">Đang làm việc</option>
            <option value="LOCKED">Đã khóa</option>
          </select>
          <span className="badge b-green-flat" style={{ borderRadius: 8, padding: '6px 12px' }}>
            {activeCount} Đang làm việc
          </span>
          <span
            className="badge b-rose-soft"
            style={{
              borderRadius: 8,
              padding: '6px 12px',
              background: 'var(--rose-100)',
              color: 'var(--rose-900)',
            }}
          >
            {lockedCount} Đã khóa tài khoản
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-md"
          style={{ padding: '8px 16px' }}
          onClick={openCreateModal}
        >
          + Thêm nhân viên mới
        </button>
      </section>

      <section className="card col g16">
        <div className="row between wrap g12">
          <h2 className="t14 w800 c-ink">Danh sách nhân viên thu ngân tại các cơ sở</h2>
          <span className="t12 c-s600">Nhấp "Sửa" để thay đổi cơ sở hoặc thông tin liên hệ</span>
        </div>

        {staffQ.isError && (
          <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
            {extractErrorMessage(staffQ.error, 'Không thể tải danh sách nhân viên.')}
          </div>
        )}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mã NV / Họ và tên</th>
                <th>Số điện thoại / Email</th>
                <th>Chi nhánh làm việc</th>
                <th>Giao dịch đã thực hiện</th>
                <th>Trạng thái</th>
                <th className="r">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {staffQ.isLoading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>
                    Đang tải danh sách nhân viên...
                  </td>
                </tr>
              )}
              {!staffQ.isLoading && list.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--s600)' }}>
                    Không tìm thấy nhân viên phù hợp.
                  </td>
                </tr>
              )}
              {list.map((s) => {
                const isLocked = s.status === 'LOCKED';
                const isEditing = editingStaff?.userId === s.userId && modalOpen;
                return (
                  <tr key={s.userId} className={isLocked ? 'dim' : isEditing ? 'hl' : ''}>
                    <td>
                      <div
                        className="mono w800"
                        style={{ fontSize: 10.5, color: isLocked ? 'var(--s700)' : 'var(--s900)' }}
                      >
                        {s.code}
                      </div>
                      <div className="w700" style={{ color: isLocked ? 'var(--s700)' : 'var(--s800)' }}>
                        {s.fullName}
                      </div>
                    </td>
                    <td>
                      <div className="mono w700" style={{ fontSize: 11 }}>
                        {s.phone}
                      </div>
                      <div className="c-s600">{s.email ?? '—'}</div>
                    </td>
                    <td>
                      <span
                        className={`badge ${isLocked ? 'b-gray' : 'b-green'}`}
                        style={{
                          borderRadius: 8,
                          fontWeight: isLocked ? 600 : 700,
                          background: isLocked ? 'var(--s200)' : undefined,
                        }}
                      >
                        {s.branch.name}
                      </span>
                    </td>
                    <td>
                      <div className="w700">{s.counterBookingCount} đơn tại quầy</div>
                      <div className={isLocked ? 'c-brand8 w700' : 'c-s600'}>
                        Tổng thu: {vnd(s.collectedAmount)}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${isLocked ? 'b-rose' : 'b-green'}`}
                        style={{ background: isLocked ? 'var(--rose-100)' : undefined }}
                      >
                        {isLocked ? 'Đã khóa' : 'Đang làm việc'}
                      </span>
                    </td>
                    <td className="r">
                      <div className="row g8" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '6px 10px', color: 'var(--s800)' }}
                          onClick={() => openHistoryModal(s)}
                        >
                          Giao dịch
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '6px 10px', color: 'var(--s800)' }}
                          onClick={() => openEditModal(s)}
                        >
                          Sửa
                        </button>
                        {isLocked ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={togglingId === s.userId}
                            style={{
                              background: '#fff',
                              border: '1px solid var(--brand-400)',
                              color: 'var(--brand-800)',
                              padding: '6px 10px',
                            }}
                            onClick={() => void handleToggleLock(s)}
                          >
                            Mở khóa
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-danger-o btn-sm"
                            disabled={togglingId === s.userId}
                            style={{ padding: '6px 10px' }}
                            onClick={() => void handleToggleLock(s)}
                          >
                            Khóa
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

        {totalPages > 1 && (
          <div className="row between g12">
            <span className="t12 c-s600">
              Trang {page} / {totalPages} ({meta?.totalItems ?? 0} nhân viên)
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
                onClick={() => setPage((p) => p + 1)}
              >
                Sau →
              </button>
            </div>
          </div>
        )}

        <div className="hint" style={{ lineHeight: '16px' }}>
          🔒 Khi khóa tài khoản nhân viên đã nghỉ việc, tài khoản đó sẽ không thể đăng nhập vào hệ thống nhưng toàn bộ lịch sử hóa đơn và giao dịch thu tiền trước đây vẫn được lưu giữ đầy đủ để đối soát doanh thu. Có thể mở khóa lại bất cứ lúc nào.
        </div>
      </section>

      {modalOpen && (
        <div className="modal-bg" onClick={() => !saving && setModalOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 480, maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="col head-rule" style={{ gap: 4 }}>
              <span className="eyebrow">Thông tin tài khoản</span>
              <h3 className="t18 w800 c-ink">
                {editingStaff ? `Chỉnh sửa nhân viên ${editingStaff.code}` : 'Thêm nhân viên mới'}
              </h3>
            </div>
            <form noValidate className="col g14" onSubmit={(e) => void handleSave(e)}>
              <div>
                <label className="label">
                  Họ và tên nhân viên <span className="req">*</span>
                </label>
                <input
                  className="input sm"
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">
                  Số điện thoại đăng nhập <span className="req">*</span>
                </label>
                <input
                  className="input sm bold"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Địa chỉ Email</label>
                <input
                  className="input sm"
                  style={{ fontWeight: 500 }}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">
                  Chi nhánh phân công <span className="req">*</span>
                </label>
                <select
                  className="select sm"
                  value={form.branchId ? String(form.branchId) : ''}
                  onChange={(e) => setForm((f) => ({ ...f, branchId: Number(e.target.value) }))}
                >
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">
                  {editingStaff ? 'Mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu cấp mới'}{' '}
                  {!editingStaff && <span className="req">*</span>}
                </label>
                <input
                  className="input sm"
                  style={{ fontWeight: 500 }}
                  type="password"
                  placeholder="8–32 ký tự, gồm chữ và số"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Trạng thái làm việc</label>
                <select
                  className="select sm"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as UserStatus }))}
                >
                  <option value="ACTIVE">Đang làm việc</option>
                  <option value="LOCKED">Đã khóa tài khoản</option>
                </select>
              </div>
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
                <button type="submit" className="btn btn-primary btn-md" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu thông tin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyStaff && (
        <div className="modal-bg" onClick={() => setHistoryStaff(null)}>
          <div
            className="modal"
            style={{ maxWidth: 620, maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="col g4">
              <h3 className="t18 w800 c-ink">
                Giao dịch thu tiền của {historyStaff.fullName} ({historyStaff.code})
              </h3>
              <p className="t12 c-s600">
                Tổng tiền đã thu trong kỳ lọc:{' '}
                <b className="c-brand8">{vnd(paymentsMeta?.totalAmount ?? 0)}</b>
              </p>
            </div>

            <div className="row g8 wrap">
              <span className="t12 w600 c-s700">Từ ngày:</span>
              <input
                type="date"
                className="input sm"
                style={{ width: 'auto' }}
                value={payFrom}
                onChange={(e) => {
                  setPayFrom(e.target.value);
                  setPayPage(1);
                }}
              />
              <span className="t12 w600 c-s700">Đến ngày:</span>
              <input
                type="date"
                className="input sm"
                style={{ width: 'auto' }}
                value={payTo}
                onChange={(e) => {
                  setPayTo(e.target.value);
                  setPayPage(1);
                }}
              />
            </div>

            {paymentsQ.isLoading && (
              <div className="hint" style={{ textAlign: 'center', padding: 16 }}>
                Đang tải lịch sử giao dịch...
              </div>
            )}
            {paymentsQ.isError && (
              <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
                {extractErrorMessage(paymentsQ.error, 'Không thể tải lịch sử giao dịch.')}
              </div>
            )}
            {!paymentsQ.isLoading && !paymentsQ.isError && payments.length === 0 && (
              <div className="hint" style={{ textAlign: 'center', padding: 16 }}>
                Không có giao dịch thu tiền nào trong khoảng thời gian đã chọn.
              </div>
            )}
            {payments.map((t) => (
              <div
                key={t.paymentCode}
                className="row between g12 t12"
                style={{ border: '1px solid var(--s300)', borderRadius: 10, padding: 10 }}
              >
                <div className="col">
                  <b className="c-ink mono">
                    {t.paymentCode} • #{t.bookingCode}
                  </b>
                  <span className="c-s600">
                    {formatDateTimeVn(t.paidAt)}
                    {t.collectedByName ? ` • ${t.collectedByName}` : ''}
                  </span>
                </div>
                <div className="col" style={{ alignItems: 'flex-end' }}>
                  <b className="c-brand8">{vnd(t.amount)}</b>
                  <span className="c-s600">
                    {PURPOSE_LABELS[t.purpose]} • {METHOD_LABELS[t.method]}
                  </span>
                </div>
              </div>
            ))}

            {(paymentsMeta?.totalPages ?? 1) > 1 && (
              <div className="row between g8">
                <span className="t11 c-s600">
                  Trang {payPage} / {paymentsMeta?.totalPages}
                </span>
                <div className="row g8">
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    disabled={payPage <= 1}
                    onClick={() => setPayPage((p) => Math.max(1, p - 1))}
                  >
                    ← Trước
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    disabled={payPage >= (paymentsMeta?.totalPages ?? 1)}
                    onClick={() => setPayPage((p) => p + 1)}
                  >
                    Sau →
                  </button>
                </div>
              </div>
            )}

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                onClick={() => setHistoryStaff(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
