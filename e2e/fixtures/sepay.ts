import { API_BASE_URL } from './api.js';

export interface SendSepayWebhookParams {
  bookingCode?: string;
  content?: string;
  amount: number;
  accountNo: string;
  txnId?: string;
  transferType?: 'in' | 'out';
  gateway?: string;
  transactionDate?: string;
}

function nowVnSqlString(): string {
  const d = new Date(Date.now() + 7 * 3600_000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * I-02: Gửi webhook SePay thật tới POST /api/v1/webhooks/bank/sepay.
 */
export async function sendSepayWebhook(params: SendSepayWebhookParams): Promise<{
  txnId: string;
  status: number;
  body: unknown;
}> {
  const apiKey = process.env.E2E_SEPAY_API_KEY || 'sporthub-dev-sepay-key';
  const txnId =
    params.txnId ?? `E2ESP${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
  const content =
    params.content ??
    (params.bookingCode ? `THANHTOAN ${params.bookingCode}` : 'CHUYEN KHOAN SPORTHUB');

  const payload = {
    id: txnId,
    gateway: params.gateway ?? (params.accountNo === '0201234567' ? 'MBBank' : 'Vietcombank'),
    transactionDate: params.transactionDate ?? nowVnSqlString(),
    accountNumber: params.accountNo,
    code: null,
    content,
    transferType: params.transferType ?? 'in',
    transferAmount: params.amount,
    accumulated: 0,
    subAccount: null,
    referenceCode: txnId,
    description: content,
  };

  const res = await fetch(`${API_BASE_URL}/webhooks/bank/sepay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Apikey ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    throw new Error(`sendSepayWebhook failed (${res.status}): ${text}`);
  }
  return { txnId, status: res.status, body };
}
