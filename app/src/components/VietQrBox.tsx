import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '../ui/toastContext.ts';
import { vnd } from '../utils/format.ts';

interface Props {
  qrPayload: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  amount: number;
  transferContent: string;
  variant?: 'full' | 'compact';
  imgTestId?: string;
  amountTestId?: string;
  contentTestId?: string;
}

/** Khối VietQR dùng chung: màn thanh toán online, POS tại quầy và tất toán QR. */
export default function VietQrBox({
  qrPayload,
  bankName,
  bankAccountNo,
  bankAccountName,
  amount,
  transferContent,
  variant = 'full',
  imgTestId,
  amountTestId,
  contentTestId,
}: Props) {
  const { toast } = useToast();

  const copyText = (text: string, label: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    toast(`Đã sao chép ${label}: ${text}`, 'ok');
  };

  if (variant === 'compact') {
    return (
      <div
        className="row g12"
        style={{
          background: 'var(--s100)',
          border: '1px solid var(--s300)',
          borderRadius: 12,
          padding: 12,
        }}
      >
        <div
          data-testid={imgTestId}
          style={{
            background: '#fff',
            padding: 6,
            borderRadius: 8,
            border: '1px solid var(--s300)',
            flex: 'none',
          }}
        >
          <QRCodeSVG value={qrPayload} size={96} />
        </div>
        <div className="t12 c-s700 col g4">
          <b className="c-ink">
            Khách quét mã để chuyển <span data-testid={amountTestId}>{vnd(amount)}</span>
          </b>
          <span>
            {bankName} • STK {bankAccountNo}
          </span>
          <span>
            Nội dung: <b data-testid={contentTestId}>{transferContent}</b>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="row g24 wrap"
      style={{
        background: 'var(--s100)',
        border: '1px solid var(--s300)',
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div
        className="col g8"
        style={{
          background: '#fff',
          border: '2px solid var(--brand-700)',
          borderRadius: 16,
          padding: 16,
          boxShadow: 'var(--shadow-sm)',
          alignItems: 'center',
        }}
      >
        <div data-testid={imgTestId}>
          <QRCodeSVG value={qrPayload} size={176} />
        </div>
        <span className="t11 w700 c-brand8">VietQR • Đã điền sẵn số tiền</span>
      </div>
      <div className="col g10 f1">
        <div className="hint" style={{ background: '#fff', padding: 12 }}>
          <div className="c-s500">Ngân hàng nhận:</div>
          <b className="t14 w800 c-ink">{bankName}</b>
        </div>
        <div className="hint row between" style={{ background: '#fff', padding: 12 }}>
          <div>
            <div className="c-s500">Số tài khoản:</div>
            <b className="t14 w800 c-ink">{bankAccountNo}</b>
          </div>
          <div className="col g4" style={{ alignItems: 'flex-end' }}>
            <b className="t11 c-brand8">{bankAccountName}</b>
            <button
              type="button"
              className="link-btn"
              onClick={() => copyText(bankAccountNo, 'số tài khoản')}
            >
              Sao chép STK
            </button>
          </div>
        </div>
        <div
          className="hint row between"
          style={{
            background: 'rgba(209,250,229,.8)',
            borderColor: 'var(--gray-200)',
            padding: 12,
          }}
        >
          <div className="col g2">
            <b className="c-brand9">Số tiền cần chuyển:</b>
            <b
              className="t16 w800 c-brand9"
              style={{ lineHeight: '24px' }}
              data-testid={amountTestId ?? 'qr-amount'}
            >
              {vnd(amount)}
            </b>
          </div>
          <span
            className="badge sq"
            style={{
              background: '#fff',
              border: '1px solid var(--gray-200)',
              color: 'var(--brand-800)',
              fontSize: 11,
            }}
          >
            Đúng số tiền
          </span>
        </div>
        <div className="hint row between" style={{ background: '#fff', padding: 12 }}>
          <div>
            <div className="c-s500">Nội dung chuyển khoản:</div>
            <b className="t14 w800 c-ink" data-testid={contentTestId ?? 'qr-content'}>
              {transferContent}
            </b>
          </div>
          <button
            type="button"
            className="link-btn"
            onClick={() => copyText(transferContent, 'nội dung')}
          >
            Sao chép nội dung
          </button>
        </div>
      </div>
    </div>
  );
}
