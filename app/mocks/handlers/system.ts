/** Webhook SePay (SDD 5.6) + công cụ dev riêng của bản mock (/api/v1/__mock/...) */
import { http, HttpResponse } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db, reset } from '../db/store';
import { E } from '../lib/errors';
import { ok, route } from '../lib/http';
import { applyBankTransfer, simulateTransfer } from '../lib/ops';
import { mustBooking } from '../lib/schedule';
import { nowIso } from '../lib/time';
import { runJobs } from '../jobs';

const A = MOCK_CONFIG.apiBase;

interface SepayPayload {
  id?: number | string;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  content?: string;
  transferType?: 'in' | 'out';
  transferAmount?: number;
}

export const systemHandlers = [
  // Webhook cổng thanh toán
  http.post(`${A}/webhooks/bank/:provider`, route(async (ctx) => {
    const auth = ctx.request.headers.get('authorization') ?? '';
    if (!/^Apikey\s+\S+/i.test(auth) && !ctx.request.headers.get('x-sepay-signature')) {
      return HttpResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const body = await ctx.body<SepayPayload>();
    if (body.id == null || !body.accountNumber || body.transferAmount == null) {
      return HttpResponse.json({ success: false, message: 'Invalid payload' }, { status: 400 });
    }
    const transactionAt = body.transactionDate ? `${body.transactionDate.replace(' ', 'T')}+07:00` : nowIso();
    const { txn } = applyBankTransfer({
      provider: ctx.p('provider').toUpperCase(),
      providerTxnId: String(body.id),
      bankName: body.gateway ?? null,
      accountNo: body.accountNumber,
      amount: Number(body.transferAmount),
      content: body.content ?? '',
      transactionAt,
      rawPayload: body,
    });
    if (body.transferType === 'out' && txn.matchStatus !== 'MATCHED') {
      txn.matchStatus = 'IGNORED';
      txn.issue = null;
    }
    return HttpResponse.json({ success: true });
  })),

  /* ---------------- công cụ dev */

  http.get(`${A}/__mock/accounts`, route(() =>
    ok(
      db().users
        .filter((u) => u.status === 'ACTIVE')
        .map((u) => ({ role: u.role, fullName: u.fullName, phone: u.phone, email: u.email, password: u.password, branchId: u.branchId })),
    ),
  )),

  http.post(`${A}/__mock/reset`, route(() => {
    const s = reset();
    return ok({ seededAt: s.seededAt, bookings: s.bookings.length });
  })),

  http.post(`${A}/__mock/run-jobs`, route(() => ok({ changed: runJobs() }))),

  /** Giả lập khách chuyển khoản: body tùy chọn { amount, content } để thử sai số tiền / sai nội dung */
  http.post(`${A}/__mock/bookings/:bookingCode/pay`, route(async (ctx) => {
    const b = mustBooking(ctx.p('bookingCode'));
    const body = await ctx.body<{ amount?: number; content?: string }>();
    if (b.status !== 'PENDING_PAYMENT' && b.status !== 'CONFIRMED' && body.amount == null) {
      throw E.rule('BOOKING_NOT_PAYABLE', 'Đơn không còn khoản phải thu.');
    }
    const { txn } = simulateTransfer(b, body);
    return ok({ bankTxnId: txn.bankTxnId, matchStatus: txn.matchStatus, issue: txn.issue, bookingStatus: b.status, paymentStatus: b.paymentStatus });
  })),

  http.get(`${A}/__mock/db`, route(() => ok(db()))),
];
