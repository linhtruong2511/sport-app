import type { Branch } from '../data'
import { useApp } from '../appContext'
import { vnd } from '../utils/format'
import qr from '../assets/icons/qr.svg'

interface Props {
  branch: Branch; amount: number; content: string
  variant?: 'full' | 'compact'
  alt?: string
  imgTestId?: string; amountTestId?: string; contentTestId?: string
}

/** Khối VietQR dùng chung: màn 04 (/payment/:id), màn 06 (POS quầy) và màn 07 (Tất toán QR). STK theo từng chi nhánh. */
export default function VietQrBox({ branch, amount, content, variant = 'full', alt = 'Mã VietQR', imgTestId, amountTestId, contentTestId }: Props) {
  const { toast } = useApp()
  const copy = () => {
    void navigator.clipboard?.writeText(branch.bankAccNo).catch(() => undefined)
    toast(`Đã sao chép số tài khoản ${branch.bankAccNo}.`, 'ok')
  }
  if (variant === 'compact') {
    return (
      <div className="row g12" style={{ background: 'var(--s100)', border: '1px solid var(--s300)', borderRadius: 12, padding: 12 }}>
        <img src={qr} alt={alt} width={96} height={96} data-testid={imgTestId} />
        <div className="t12 c-s700 col g4">
          <b className="c-ink">Khách quét mã để chuyển <span data-testid={amountTestId}>{vnd(amount)}</span></b>
          <span>{branch.bankName} • STK {branch.bankAccNo}</span>
          <span>Nội dung: <b data-testid={contentTestId}>{content}</b></span>
        </div>
      </div>
    )
  }
  return (
    <div className="row g24" style={{ background: 'var(--s100)', border: '1px solid var(--s300)', borderRadius: 16, padding: 20 }}>
      <div className="col g8" style={{ background: '#fff', border: '2px solid var(--brand-700)', borderRadius: 16, padding: 16, boxShadow: 'var(--shadow-sm)', alignItems: 'center' }}>
        <img src={qr} alt={alt} width={176} height={176} data-testid={imgTestId} />
        <span className="t11 w700 c-brand8">VietQR • Đã điền sẵn số tiền</span>
      </div>
      <div className="col g10 f1">
        <div className="hint" style={{ background: '#fff', padding: 12 }}><div className="c-s500">Ngân hàng nhận:</div><b className="t14 w800 c-ink">{branch.bankName} - Chi nhánh {branch.short}</b></div>
        <div className="hint row between" style={{ background: '#fff', padding: 12 }}>
          <div><div className="c-s500">Số tài khoản:</div><b className="t14 w800 c-ink">{branch.bankAccNo}</b></div>
          <div className="col g4" style={{ alignItems: 'flex-end' }}><b className="t11 c-brand8">{branch.bankAccName}</b><button type="button" className="link-btn" onClick={copy}>Sao chép STK</button></div>
        </div>
        <div className="hint row between" style={{ background: 'rgba(209,250,229,.8)', borderColor: 'var(--gray-200)', padding: 12 }}>
          <div className="col g2"><b className="c-brand9">Số tiền cần chuyển:</b><b className="t16 w800 c-brand9" style={{ lineHeight: '24px' }} data-testid={amountTestId ?? 'qr-amount'}>{vnd(amount)}</b></div>
          <span className="badge sq" style={{ background: '#fff', border: '1px solid var(--gray-200)', color: 'var(--brand-800)', fontSize: 11 }}>Đúng số tiền</span>
        </div>
        <div className="hint" style={{ background: '#fff', padding: 12 }}><div className="c-s500">Nội dung chuyển khoản:</div><b className="t14 w800 c-ink" data-testid={contentTestId ?? 'qr-content'}>{content}</b></div>
      </div>
    </div>
  )
}
