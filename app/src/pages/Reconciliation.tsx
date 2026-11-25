import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  BOOKING_STATUS_LABELS,
  CANCEL_TYPE_LABELS,
  type BankMatchStatus,
  type ReconciliationIssue,
  type RefundStatus,
} from '@sporthub/shared';
import { bookingsKeys } from '../api/bookings.ts';
import { dashboardKeys } from '../api/dashboard.ts';
import { posKeys } from '../api/pos.ts';
import { queryClient } from '../api/queryClient.ts';
import {
  completeRefund,
  failRefund,
  ignoreBankTransaction,
  matchBankTransaction,
  reconciliationKeys,
  refundBankTransaction,
  useReconciliationCandidates,
  useReconciliationTransactions,
  useRefunds,
  useRefundsWithMeta,
  type ReconciliationTransactionItem,
  type RefundItem,
} from '../api/reconciliation.ts';
import { useAuth } from '../auth/authContext.ts';
import type { StaffOutlet } from '../layouts.tsx';
import { useToast } from '../ui/toastContext.ts';
import { extractErrorMessage, formatDateTimeVn, vnd } from '../utils/format.ts';

type PageTab = 'recon' | 'refund';
type TxnStatusTab = 'NEEDS_REVIEW' | 'RESOLVED' | 'IGNORED';

const ISSUE_LABELS: Record<ReconciliationIssue, string> = {
  WRONG_AMOUNT: 'Sai số tiền',
  UNKNOWN_CONTENT: 'Sai nội dung chuyển khoản',
  LATE_PAYMENT: 'Chuyển trễ hạn giữ chỗ',
  ACCOUNT_MISMATCH: 'Sai tài khoản nhận',
};

const MATCH_STATUS_META: Record<BankMatchStatus, { cls: string; label: string }> = {
  PENDING: { cls: 'b-gray', label: 'Đang chờ' },
  MATCHED: { cls: 'b-green', label: 'Khớp tự động' },
  NEEDS_REVIEW: { cls: 'b-amber', label: 'Cần đối soát' },
  RESOLVED: { cls: 'b-green', label: 'Đã xử lý' },
  IGNORED: { cls: 'b-gray', label: 'Đã bỏ qua' },
};

const REFUND_STATUS_META: Record<RefundStatus, { cls: string; label: string }> = {
  PENDING: { cls: 'b-amber', label: 'Chờ hoàn tiền' },
  COMPLETED: { cls: 'b-green', label: 'Đã hoàn tiền' },
  FAILED: { cls: 'b-rose', label: 'Hoàn thất bại' },
};

/** Đối soát giao dịch ngân hàng (STAFF & OWNER) & Hoàn tiền chờ xử lý (OWNER). */
export default function Reconciliation() {
  const { user } = useAuth();
  const { branchFilter } = useOutletContext<StaffOutlet>();
  const { toast } = useToast();

  const isOwner = user?.role === 'OWNER';
  const scopedBranchId = branchFilter === 'all' ? undefined : branchFilter;

  const [tab, setTab] = useState<PageTab>('recon');
  const [txnStatus, setTxnStatus] = useState<TxnStatusTab>('NEEDS_REVIEW');
  const [txnPage, setTxnPage] = useState(1);

  const [matchTarget, setMatchTarget] = useState<ReconciliationTransactionItem | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedBookingCode, setSelectedBookingCode] = useState('');
  const [matchNote, setMatchNote] = useState('');
  const [matchErr, setMatchErr] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);

  const [refundTxnTarget, setRefundTxnTarget] = useState<ReconciliationTransactionItem | null>(null);
  const [refundTxnNote, setRefundTxnNote] = useState('');
  const [refundTxnErr, setRefundTxnErr] = useState('');
  const [refundTxnBusy, setRefundTxnBusy] = useState(false);

  const [ignoringTxnId, setIgnoringTxnId] = useState<number | null>(null);

  const [refundStatusFilter, setRefundStatusFilter] = useState<RefundStatus>('PENDING');
  const [busyRefundId, setBusyRefundId] = useState<number | null>(null);
  const [failTarget, setFailTarget] = useState<RefundItem | null>(null);
  const [failNote, setFailNote] = useState('');
  const [failErr, setFailErr] = useState('');
  const [failBusy, setFailBusy] = useState(false);

  const txnsQ = useReconciliationTransactions({
    branchId: scopedBranchId,
    status: txnStatus,
    page: txnPage,
  });

  const candidatesQ = useReconciliationCandidates(
    matchTarget?.bankTxnId,
    { q: candidateSearch.trim() || undefined },
    { enabled: Boolean(matchTarget) },
  );

  const refundsQ = useRefunds(
    {
      branchId: scopedBranchId,
      status: refundStatusFilter,
    },
    { enabled: isOwner && tab === 'refund' },
  );

  const pendingRefundsCountQ = useRefundsWithMeta(
    {
      branchId: scopedBranchId,
      status: 'PENDING',
    },
    { enabled: isOwner },
  );

  const txns = txnsQ.data?.data ?? [];
  const countByStatus = txnsQ.data?.meta.countByStatus ?? {
    NEEDS_REVIEW: 0,
    RESOLVED: 0,
    IGNORED: 0,
  };
  const txnTotalPages = txnsQ.data?.meta.totalPages ?? 1;

  const candidates = candidatesQ.data ?? [];
  const refunds = refundsQ.data ?? [];
  const pendingRefundCount = pendingRefundsCountQ.data?.meta.total ?? 0;
  const pendingRefundTotalAmount = pendingRefundsCountQ.data?.meta.totalAmount ?? 0;

  const invalidateAfterRecon = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all }),
      queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
      queryClient.invalidateQueries({ queryKey: posKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
    ]);
  };

  const openMatchModal = (t: ReconciliationTransactionItem) => {
    setMatchTarget(t);
    setCandidateSearch('');
    setSelectedBookingCode(t.matchedBooking?.bookingCode ?? '');
    setMatchNote('');
    setMatchErr('');
  };

  const handleConfirmMatch = async () => {
    if (!matchTarget) return;
    if (!selectedBookingCode) {
      setMatchErr('Vui lòng chọn đơn đặt sân để khớp giao dịch.');
      return;
    }
    setMatchErr('');
    setMatchBusy(true);
    try {
      await matchBankTransaction(matchTarget.bankTxnId, {
        bookingCode: selectedBookingCode,
        note: matchNote.trim() || null,
      });
      await invalidateAfterRecon();
      toast(`Đã khớp giao dịch vào đơn #${selectedBookingCode}.`, 'ok');
      setMatchTarget(null);
    } catch (err) {
      setMatchErr(extractErrorMessage(err));
    } finally {
      setMatchBusy(false);
    }
  };

  const openRefundTxnModal = (t: ReconciliationTransactionItem) => {
    setRefundTxnTarget(t);
    setRefundTxnNote('');
    setRefundTxnErr('');
  };

  const handleConfirmRefundTxn = async () => {
    if (!refundTxnTarget) return;
    const note = refundTxnNote.trim();
    if (note.length < 3) {
      setRefundTxnErr('Vui lòng nhập ghi chú hoàn tiền (tối thiểu 3 ký tự).');
      return;
    }
    setRefundTxnErr('');
    setRefundTxnBusy(true);
    try {
      await refundBankTransaction(refundTxnTarget.bankTxnId, { note });
      await invalidateAfterRecon();
      toast('Đã đánh dấu hoàn lại tiền cho khách.', 'ok');
      setRefundTxnTarget(null);
    } catch (err) {
      setRefundTxnErr(extractErrorMessage(err));
    } finally {
      setRefundTxnBusy(false);
    }
  };

  const handleIgnoreTxn = async (t: ReconciliationTransactionItem) => {
    setIgnoringTxnId(t.bankTxnId);
    try {
      await ignoreBankTransaction(t.bankTxnId);
      await invalidateAfterRecon();
      toast('Đã bỏ qua giao dịch.', 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setIgnoringTxnId(null);
    }
  };

  const handleCompleteRefund = async (r: RefundItem) => {
    setBusyRefundId(r.refundId);
    try {
      await completeRefund(r.refundId);
      await queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast(`Đã đánh dấu hoàn ${vnd(r.amount)} cho ${r.customerName}.`, 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    } finally {
      setBusyRefundId(null);
    }
  };

  const openFailRefundModal = (r: RefundItem) => {
    setFailTarget(r);
    setFailNote('');
    setFailErr('');
  };

  const handleConfirmFailRefund = async () => {
    if (!failTarget) return;
    const note = failNote.trim();
    if (note.length < 3) {
      setFailErr('Vui lòng nhập lý do hoàn tiền thất bại (tối thiểu 3 ký tự).');
      return;
    }
    setFailErr('');
    setFailBusy(true);
    try {
      await failRefund(failTarget.refundId, { note });
      await queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast(`Đã đánh dấu hoàn tiền thất bại cho đơn #${failTarget.bookingCode}.`, 'info');
      setFailTarget(null);
    } catch (err) {
      setFailErr(extractErrorMessage(err));
    } finally {
      setFailBusy(false);
    }
  };

  const activeTab: PageTab = isOwner ? tab : 'recon';

  return (
    <>
      <section className="card row between wrap g16" style={{ padding: 16 }}>
        <div className="row g8 wrap">
          <button
            type="button"
            className={`btn btn-md ${activeTab === 'recon' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ background: activeTab === 'recon' ? undefined : 'var(--s100)' }}
            onClick={() => setTab('recon')}
          >
            Giao dịch ngân hàng ({countByStatus.NEEDS_REVIEW})
          </button>
          {isOwner && (
            <button
              type="button"
              className={`btn btn-md ${activeTab === 'refund' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ background: activeTab === 'refund' ? undefined : 'var(--s100)' }}
              onClick={() => setTab('refund')}
            >
              Hoàn tiền chờ xử lý ({pendingRefundCount})
            </button>
          )}
        </div>
        {isOwner && (
          <span className="t12 c-s600">
            Tổng tiền hoàn chờ xử lý:{' '}
            <b className="c-rose">
              {vnd(pendingRefundTotalAmount)}
            </b>
          </span>
        )}
      </section>

      {activeTab === 'recon' ? (
        <section className="card col g14">
          <div className="row between wrap g12">
            <div className="col g2">
              <h2 className="t14 w800 c-ink">Danh sách giao dịch ngân hàng</h2>
              <span className="t12 c-s600">
                Giao dịch chuyển sai số tiền, sai nội dung hoặc về sau khi đơn đã hết hạn giữ chỗ.
              </span>
            </div>
            <div className="row g8 wrap">
              {(
                [
                  ['NEEDS_REVIEW', `Cần đối soát (${countByStatus.NEEDS_REVIEW})`],
                  ['RESOLVED', `Đã xử lý (${countByStatus.RESOLVED})`],
                  ['IGNORED', `Đã bỏ qua (${countByStatus.IGNORED})`],
                ] as const
              ).map(([st, label]) => (
                <button
                  key={st}
                  type="button"
                  className={`btn btn-sm ${txnStatus === st ? 'btn-dark' : 'btn-outline'}`}
                  onClick={() => {
                    setTxnStatus(st);
                    setTxnPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {txnsQ.isLoading && (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Đang tải danh sách giao dịch...
            </div>
          )}
          {txnsQ.isError && (
            <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
              {extractErrorMessage(txnsQ.error, 'Không thể tải danh sách giao dịch ngân hàng.')}
            </div>
          )}
          {!txnsQ.isLoading && !txnsQ.isError && txns.length === 0 && (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Không có giao dịch nào trong mục này.
            </div>
          )}

          {txns.map((r) => {
            const statusMeta = MATCH_STATUS_META[r.matchStatus];
            return (
              <div
                key={r.bankTxnId}
                data-testid={`recon-${r.bankTxnId}`}
                className="row between g12 wrap"
                style={{
                  border: '1px solid var(--s300)',
                  borderRadius: 12,
                  padding: 14,
                  background: r.matchStatus === 'NEEDS_REVIEW' ? 'var(--amber-50)' : 'var(--s50)',
                }}
              >
                <div className="col g4 f1">
                  <div className="row g8 wrap">
                    <b className="t12 c-ink mono">
                      #{r.bankTxnId} • {r.providerTxnId}
                    </b>
                    <span className={`badge ${statusMeta.cls}`}>{statusMeta.label}</span>
                    {r.issue && <span className="badge b-gray-o">{ISSUE_LABELS[r.issue]}</span>}
                    {r.branch && <span className="badge b-sky">{r.branch.name}</span>}
                  </div>
                  <span className="t12 c-s700">
                    Nhận <b>{vnd(r.amount)}</b>
                    {r.expectedAmount !== null ? ` (đơn cần ${vnd(r.expectedAmount)})` : ''} • Nội
                    dung: <i>"{r.content}"</i>
                  </span>
                  <span className="t11 c-s600">
                    {r.bankName} ({r.accountNo}) • {formatDateTimeVn(r.transactionAt)}
                    {r.matchedBooking
                      ? ` • Đơn #${r.matchedBooking.bookingCode} (${r.matchedBooking.customerName})`
                      : ' • Chưa gắn đơn'}
                  </span>
                  {r.resolution && (
                    <span className="t11 c-brand8">
                      Xử lý: {r.resolution.action}
                      {r.resolution.resolvedByName ? ` bởi ${r.resolution.resolvedByName}` : ''}
                      {r.resolution.note ? ` — "${r.resolution.note}"` : ''}
                    </span>
                  )}
                </div>

                {r.matchStatus === 'NEEDS_REVIEW' && (
                  <div className="row g8 wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={ignoringTxnId === r.bankTxnId}
                      onClick={() => openMatchModal(r)}
                    >
                      Khớp đơn
                    </button>
                    <button
                      type="button"
                      className="btn btn-warn-o btn-sm"
                      disabled={ignoringTxnId === r.bankTxnId}
                      onClick={() => openRefundTxnModal(r)}
                    >
                      Hoàn lại khách
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={ignoringTxnId === r.bankTxnId}
                      onClick={() => void handleIgnoreTxn(r)}
                    >
                      Bỏ qua
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {txnTotalPages > 1 && (
            <div className="row between g8">
              <span className="t12 c-s600">
                Trang {txnPage} / {txnTotalPages}
              </span>
              <div className="row g8">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={txnPage <= 1}
                  onClick={() => setTxnPage((p) => Math.max(1, p - 1))}
                >
                  ← Trước
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={txnPage >= txnTotalPages}
                  onClick={() => setTxnPage((p) => p + 1)}
                >
                  Sau →
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="card col g14">
          <div className="row between wrap g12">
            <div className="col g2">
              <h2 className="t14 w800 c-ink">Khoản hoàn tiền sau khi hủy đơn</h2>
              <span className="t12 c-s600">
                Hoàn 100% (≥ 5 ngày) hoặc 50% (2 đến &lt; 5 ngày) phần đã trả vượt tiền cọc; đơn
                đóng do cơ sở hoàn trả toàn bộ ngoài hệ thống.
              </span>
            </div>
            <div className="row g8">
              {(
                [
                  ['PENDING', 'Chờ hoàn tiền'],
                  ['COMPLETED', 'Đã hoàn tiền'],
                  ['FAILED', 'Hoàn thất bại'],
                ] as const
              ).map(([st, label]) => (
                <button
                  key={st}
                  type="button"
                  className={`btn btn-sm ${refundStatusFilter === st ? 'btn-dark' : 'btn-outline'}`}
                  onClick={() => setRefundStatusFilter(st)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {refundsQ.isLoading && (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Đang tải danh sách hoàn tiền...
            </div>
          )}
          {refundsQ.isError && (
            <div className="hint" style={{ background: 'var(--rose-50)', color: 'var(--rose-900)' }}>
              {extractErrorMessage(refundsQ.error, 'Không thể tải danh sách hoàn tiền.')}
            </div>
          )}
          {!refundsQ.isLoading && !refundsQ.isError && refunds.length === 0 && (
            <div className="hint" style={{ textAlign: 'center', padding: 24 }}>
              Không có khoản hoàn tiền nào trong trạng thái này.
            </div>
          )}

          {refunds.map((r) => {
            const stMeta = REFUND_STATUS_META[r.status];
            return (
              <div
                key={r.refundId}
                className="row between g12 wrap"
                style={{
                  border: '1px solid var(--s300)',
                  borderRadius: 12,
                  padding: 14,
                  background: r.status === 'PENDING' ? 'var(--amber-50)' : 'var(--s50)',
                }}
              >
                <div className="col g4 f1">
                  <div className="row g8 wrap">
                    <b className="t12 c-ink mono">#{r.bookingCode}</b>
                    <span className={`badge ${stMeta.cls}`}>{stMeta.label}</span>
                    <span className="badge b-gray-o">{CANCEL_TYPE_LABELS[r.cancelType]}</span>
                  </div>
                  <span className="t12 c-s700">
                    {r.customerName} ({r.customerPhone}) • Hoàn {r.rate}% ={' '}
                    <b>{vnd(r.amount)}</b>
                  </span>
                  <span className="t11 c-s600">
                    Tạo lúc {formatDateTimeVn(r.createdAt)} • Lý do: {r.reason}
                    {r.processedAt ? ` • Xử lý lúc ${formatDateTimeVn(r.processedAt)}` : ''}
                    {r.note ? ` • Ghi chú: "${r.note}"` : ''}
                  </span>
                </div>
                {r.status === 'PENDING' && (
                  <div className="row g8 wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyRefundId === r.refundId}
                      onClick={() => void handleCompleteRefund(r)}
                    >
                      {busyRefundId === r.refundId ? 'Đang xử lý...' : 'Đánh dấu đã hoàn tiền'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-o btn-sm"
                      disabled={busyRefundId === r.refundId}
                      onClick={() => openFailRefundModal(r)}
                    >
                      Hoàn thất bại
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {matchTarget && (
        <div className="modal-bg" onClick={() => !matchBusy && setMatchTarget(null)}>
          <div
            className="modal"
            style={{ maxWidth: 560, maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="col g4">
              <h3 className="t18 w800 c-ink">
                Khớp giao dịch #{matchTarget.bankTxnId} ({vnd(matchTarget.amount)})
              </h3>
              <p className="t12 c-s600">
                Nội dung chuyển khoản: <i>"{matchTarget.content}"</i>
              </p>
            </div>

            <div>
              <label className="label">Tìm đơn đặt sân chờ thanh toán</label>
              <input
                className="input sm"
                placeholder="Nhập mã đơn, tên hoặc SĐT khách..."
                value={candidateSearch}
                onChange={(e) => setCandidateSearch(e.target.value)}
              />
            </div>

            <div className="col g8" style={{ maxHeight: 240, overflowY: 'auto' }}>
              {candidatesQ.isLoading && (
                <div className="hint" style={{ textAlign: 'center', padding: 12 }}>
                  Đang tìm đơn ứng viên...
                </div>
              )}
              {!candidatesQ.isLoading && candidates.length === 0 && (
                <div className="hint" style={{ textAlign: 'center', padding: 12 }}>
                  Không tìm thấy đơn chờ thanh toán phù hợp.
                </div>
              )}
              {candidates.map((c) => (
                <label
                  key={c.bookingCode}
                  className={`radio-card between${selectedBookingCode === c.bookingCode ? ' on' : ''}`}
                  style={{ justifyContent: 'space-between' }}
                >
                  <div className="row g8">
                    <input
                      type="radio"
                      name="candidate-booking"
                      checked={selectedBookingCode === c.bookingCode}
                      onChange={() => setSelectedBookingCode(c.bookingCode)}
                    />
                    <div className="col">
                      <b className="mono c-ink">
                        #{c.bookingCode} • {c.customerName}
                      </b>
                      <span className="t11 c-s600">
                        {BOOKING_STATUS_LABELS[c.status]} • Cần thu: {vnd(c.amountDue)}
                      </span>
                    </div>
                  </div>
                  <span className={`badge ${c.amountMatches ? 'b-green' : 'b-amber'}`}>
                    {c.amountMatches ? 'Khớp số tiền' : 'Lệch số tiền'}
                  </span>
                </label>
              ))}
            </div>

            <div>
              <label className="label">Ghi chú đối soát (tùy chọn)</label>
              <input
                className="input sm"
                placeholder="VD: Khách chuyển thiếu ghi nhận bù tiền mặt"
                value={matchNote}
                onChange={(e) => setMatchNote(e.target.value)}
              />
            </div>

            {matchErr && <p className="field-err">{matchErr}</p>}

            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={matchBusy}
                onClick={() => setMatchTarget(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-primary btn-md"
                disabled={matchBusy || !selectedBookingCode}
                onClick={() => void handleConfirmMatch()}
              >
                {matchBusy ? 'Đang khớp...' : 'Xác nhận khớp đơn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {refundTxnTarget && (
        <div className="modal-bg" onClick={() => !refundTxnBusy && setRefundTxnTarget(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="t18 w800 c-ink">
              Hoàn tiền giao dịch #{refundTxnTarget.bankTxnId} ({vnd(refundTxnTarget.amount)})
            </h3>
            <p className="t12 c-s600">
              Đánh dấu đã hoàn trả tiền chuyển khoản nhầm/trễ hạn cho khách hàng ngoài hệ thống.
            </p>
            <div>
              <label className="label">
                Ghi chú hoàn tiền (bắt buộc) <span className="req">*</span>
              </label>
              <textarea
                className="input sm"
                rows={3}
                placeholder="VD: Đã chuyển hoàn lại số tiền qua STK khách..."
                value={refundTxnNote}
                onChange={(e) => setRefundTxnNote(e.target.value)}
              />
            </div>
            {refundTxnErr && <p className="field-err">{refundTxnErr}</p>}
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={refundTxnBusy}
                onClick={() => setRefundTxnTarget(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-primary btn-md"
                disabled={refundTxnBusy}
                onClick={() => void handleConfirmRefundTxn()}
              >
                {refundTxnBusy ? 'Đang xử lý...' : 'Xác nhận hoàn lại khách'}
              </button>
            </div>
          </div>
        </div>
      )}

      {failTarget && (
        <div className="modal-bg" onClick={() => !failBusy && setFailTarget(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="t18 w800 c-ink">
              Đánh dấu hoàn tiền thất bại — #{failTarget.bookingCode}
            </h3>
            <p className="t12 c-s600">
              Khoản hoàn: <b>{vnd(failTarget.amount)}</b> cho {failTarget.customerName} (
              {failTarget.customerPhone}).
            </p>
            <div>
              <label className="label">
                Lý do hoàn tiền thất bại (bắt buộc) <span className="req">*</span>
              </label>
              <textarea
                className="input sm"
                rows={3}
                placeholder="VD: Không liên hệ được khách để lấy STK nhận hoàn..."
                value={failNote}
                onChange={(e) => setFailNote(e.target.value)}
              />
            </div>
            {failErr && <p className="field-err">{failErr}</p>}
            <div className="row g8" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline btn-md"
                disabled={failBusy}
                onClick={() => setFailTarget(null)}
              >
                Đóng
              </button>
              <button
                type="button"
                className="btn btn-danger btn-md"
                disabled={failBusy}
                onClick={() => void handleConfirmFailRefund()}
              >
                {failBusy ? 'Đang xử lý...' : 'Xác nhận thất bại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
