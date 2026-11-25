import { useState } from 'react';
import {
  cancelBookingApi,
  bookingsKeys,
  useCancelPreview,
  type CancelBookingResponse,
} from '../api/bookings.ts';
import { availabilityKeys } from '../api/availability.ts';
import { notificationsKeys } from '../api/notifications.ts';
import { paymentsKeys } from '../api/payments.ts';
import { queryClient } from '../api/queryClient.ts';
import { useToast } from '../ui/toastContext.ts';
import { extractErrorMessage, vnd } from '../utils/format.ts';

const CANCEL_REASON_PRESETS = [
  'Thay đổi kế hoạch cá nhân',
  'Bận công việc đột xuất không thể tham gia',
  'Đặt nhầm khung giờ',
  'Thời tiết không thuận lợi',
] as const;

interface CancelBookingModalProps {
  bookingCode: string;
  version: string;
  title?: string;
  onClose: () => void;
  onCanceled?: (res: CancelBookingResponse) => void;
}

/** Modal xác nhận hủy đơn đặt sân dùng chung, lấy hoàn tiền dự kiến từ API-20 và hủy qua API-18. */
export default function CancelBookingModal({
  bookingCode,
  version,
  title,
  onClose,
  onCanceled,
}: CancelBookingModalProps) {
  const { toast } = useToast();
  const previewQ = useCancelPreview(bookingCode, 'CUSTOMER_REQUEST');
  const [reason, setReason] = useState<string>(CANCEL_REASON_PRESETS[0]);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const preview = previewQ.data;
  const blockedByPreview = Boolean(preview && !preview.canCancel);

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setErrorMsg('Vui lòng chọn hoặc nhập lý do hủy.');
      return;
    }
    if (trimmed.length > 255) {
      setErrorMsg('Lý do hủy tối đa 255 ký tự.');
      return;
    }
    if (blockedByPreview) {
      setErrorMsg(preview?.reasonIfNot ?? 'Đơn hiện tại không thể hủy.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await cancelBookingApi(bookingCode, {
        cancelType: 'CUSTOMER_REQUEST',
        reason: trimmed,
        version,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
        queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
        queryClient.invalidateQueries({ queryKey: notificationsKeys.all }),
        queryClient.invalidateQueries({ queryKey: paymentsKeys.all }),
      ]);
      const refundNote =
        res.refund && res.refund.amount > 0
          ? ` Số tiền hoàn dự kiến: ${vnd(res.refund.amount)}.`
          : '';
      toast(`Đã hủy đơn #${bookingCode}.${refundNote}`, 'ok');
      onCanceled?.(res);
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      setErrorMsg(msg);
      toast(msg, 'err');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bookingsKeys.all }),
        queryClient.invalidateQueries({ queryKey: paymentsKeys.all }),
      ]);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        data-testid="cancel-booking-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="t18 w800 c-ink">{title ?? `Xác nhận hủy đơn #${bookingCode}?`}</h3>

        {previewQ.isLoading && (
          <div className="hint" style={{ textAlign: 'center', padding: 16 }}>
            Đang tính toán chính sách hoàn hủy...
          </div>
        )}

        {previewQ.isError && (
          <div className="field-err">
            {extractErrorMessage(previewQ.error, 'Không thể tải thông tin hoàn hủy.')}
          </div>
        )}

        {preview && (
          <>
            {!preview.canCancel ? (
              <div
                className="hint col g6"
                style={{
                  background: 'var(--rose-50)',
                  borderColor: 'var(--rose-300)',
                  color: 'var(--rose-950)',
                }}
              >
                <b>Không thể hủy đơn này</b>
                <span>{preview.reasonIfNot ?? 'Đơn không đủ điều kiện hủy.'}</span>
              </div>
            ) : preview.paidAmount > 0 ? (
              <div
                className="hint col g6"
                style={{
                  background: 'var(--rose-50)',
                  borderColor: 'var(--rose-300)',
                  color: 'var(--rose-950)',
                }}
              >
                <span>
                  Đã thanh toán: <b>{vnd(preview.paidAmount)}</b> • Tiền cọc giữ lại:{' '}
                  <b>{vnd(preview.depositKept)}</b>
                </span>
                <span>
                  Tỷ lệ hoàn phần vượt cọc:{' '}
                  <b data-testid="cancel-refund-rate">{preview.refundRate}%</b>
                </span>
                <span>
                  Số tiền được hoàn dự kiến:{' '}
                  <b data-testid="cancel-refund-amount">{vnd(preview.refundAmount)}</b>
                </span>
                {preview.policyText && <span className="t11 c-s700">{preview.policyText}</span>}
              </div>
            ) : (
              <div className="hint col g4">
                <span>
                  {preview.policyText ||
                    'Đơn chưa phát sinh thanh toán nên không có khoản hoàn tiền.'}
                </span>
                <span data-testid="cancel-refund-rate" hidden>
                  {preview.refundRate}%
                </span>
                <span data-testid="cancel-refund-amount" hidden>
                  {vnd(preview.refundAmount)}
                </span>
              </div>
            )}
          </>
        )}

        <div className="col g8">
          <label className="label" style={{ marginBottom: 0 }}>
            Lý do hủy <span className="req">*</span>
          </label>
          <div className="row g6 wrap">
            {CANCEL_REASON_PRESETS.map((preset) => {
              const selected = reason === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  className={`btn btn-xs btn-wrap ${selected ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => {
                    setReason(preset);
                    setErrorMsg('');
                  }}
                >
                  {preset}
                </button>
              );
            })}
          </div>
          <textarea
            data-testid="cancel-reason-input"
            className="input"
            rows={3}
            maxLength={255}
            placeholder="Nhập lý do hủy đơn (tối đa 255 ký tự)..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrorMsg('');
            }}
          />
        </div>

        {errorMsg && <p className="field-err">{errorMsg}</p>}

        <div className="row g8 wrap" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-outline btn-md"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Giữ lịch
          </button>
          <button
            type="button"
            data-testid="confirm-cancel-btn"
            className="btn btn-danger btn-md"
            disabled={isSubmitting || previewQ.isLoading || blockedByPreview}
            onClick={() => void handleConfirm()}
          >
            {isSubmitting ? 'Đang hủy...' : 'Xác nhận hủy'}
          </button>
        </div>
      </div>
    </div>
  );
}
