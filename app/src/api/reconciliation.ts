import { useQuery } from '@tanstack/react-query';
import type {
  ApiListSuccess,
  ApiSuccess,
  BankMatchStatus,
  BookingStatus,
  CancelType,
  PaymentStatus,
  ReceiptDto,
  ReconciliationIssue,
  RefundStatus,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export type ReconciliationStatusFilter = 'NEEDS_REVIEW' | 'RESOLVED' | 'IGNORED' | 'ALL';

export interface GetReconciliationTransactionsParams {
  branchId?: number;
  status?: ReconciliationStatusFilter;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ReconciliationBranchRef {
  branchId: number;
  name: string;
}

export interface ReconciliationMatchedBookingRef {
  bookingCode: string;
  status: BookingStatus;
  customerName: string;
}

export type ReconciliationResolutionAction = 'MATCHED' | 'REFUNDED' | 'IGNORED';

export interface ReconciliationResolutionInfo {
  action: ReconciliationResolutionAction;
  note: string | null;
  resolvedByName: string | null;
  resolvedAt?: string | null;
}

export interface ReconciliationTransactionItem {
  bankTxnId: number;
  provider: string;
  providerTxnId: string;
  bankName: string;
  accountNo: string;
  branch: ReconciliationBranchRef | null;
  amount: number;
  content: string;
  transactionAt: string;
  matchStatus: BankMatchStatus;
  issue: ReconciliationIssue | null;
  expectedAmount: number | null;
  matchedBooking: ReconciliationMatchedBookingRef | null;
  resolution: ReconciliationResolutionInfo | null;
}

export type ReconciliationTransactionsListResponse = ApiListSuccess<ReconciliationTransactionItem> & {
  meta: {
    countByStatus: Record<'NEEDS_REVIEW' | 'RESOLVED' | 'IGNORED', number>;
  };
};

export interface GetReconciliationCandidatesParams {
  q?: string;
}

export interface ReconciliationCandidateItem {
  bookingCode: string;
  customerName: string;
  status: BookingStatus;
  amountDue: number;
  amountMatches: boolean;
}

export interface MatchBankTransactionInput {
  bookingCode: string;
  note?: string | null;
}

export interface MatchBankTransactionBookingSnapshot {
  bookingCode: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
}

export interface MatchBankTransactionResponse {
  bankTxnId: number;
  matchStatus: Extract<BankMatchStatus, 'RESOLVED'>;
  booking: MatchBankTransactionBookingSnapshot;
  receipt: ReceiptDto;
}

export interface RefundBankTransactionInput {
  note: string;
}

export interface RefundBankTransactionResponse {
  bankTxnId: number;
  matchStatus: Extract<BankMatchStatus, 'RESOLVED'>;
  resolution: {
    action: Extract<ReconciliationResolutionAction, 'REFUNDED'>;
    note: string;
    resolvedByName: string;
  };
}

export interface IgnoreBankTransactionInput {
  note?: string | null;
}

export interface IgnoreBankTransactionResponse {
  bankTxnId: number;
  matchStatus: Extract<BankMatchStatus, 'IGNORED'>;
}

export interface GetRefundsParams {
  branchId?: number;
  status?: RefundStatus;
}

export interface RefundItem {
  refundId: number;
  bookingCode: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  rate: number;
  cancelType: CancelType;
  reason: string;
  status: RefundStatus;
  createdAt: string;
  processedAt: string | null;
  note: string | null;
}

export interface UpdateRefundStatusInput {
  note?: string | null;
}

export interface UpdateRefundStatusResponse {
  refundId: number;
  status: Extract<RefundStatus, 'COMPLETED' | 'FAILED'>;
  processedAt: string;
  processedByName: string;
}

export const reconciliationKeys = {
  all: ['reconciliation'] as const,
  transactions: (params?: GetReconciliationTransactionsParams) =>
    ['reconciliation', 'transactions', params ?? {}] as const,
  candidates: (
    bankTxnId: number | null | undefined,
    params?: GetReconciliationCandidatesParams,
  ) => ['reconciliation', 'candidates', bankTxnId ?? null, params ?? {}] as const,
  refunds: (params?: GetRefundsParams) => ['reconciliation', 'refunds', params ?? {}] as const,
};

// API-67
export async function getReconciliationTransactions(
  params?: GetReconciliationTransactionsParams,
): Promise<ReconciliationTransactionsListResponse> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (params?.status) {
    search.set('status', params.status);
  }
  if (params?.from) {
    search.set('from', params.from);
  }
  if (params?.to) {
    search.set('to', params.to);
  }
  if (typeof params?.page === 'number') {
    search.set('page', String(params.page));
  }
  if (typeof params?.pageSize === 'number') {
    search.set('pageSize', String(params.pageSize));
  }
  const qs = search.toString();
  return apiFetch<ReconciliationTransactionsListResponse>(
    qs ? `/reconciliation/transactions?${qs}` : '/reconciliation/transactions',
  );
}

// API-68
export async function getReconciliationCandidates(
  bankTxnId: number,
  params?: GetReconciliationCandidatesParams,
): Promise<ReconciliationCandidateItem[]> {
  const search = new URLSearchParams();
  if (params?.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  const qs = search.toString();
  const path = qs
    ? `/reconciliation/transactions/${bankTxnId}/candidates?${qs}`
    : `/reconciliation/transactions/${bankTxnId}/candidates`;
  const res = await apiFetch<ApiSuccess<ReconciliationCandidateItem[]>>(path);
  return res.data;
}

// API-69
export async function matchBankTransaction(
  bankTxnId: number,
  body: MatchBankTransactionInput,
): Promise<MatchBankTransactionResponse> {
  const res = await apiFetch<ApiSuccess<MatchBankTransactionResponse>>(
    `/reconciliation/transactions/${bankTxnId}/match`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-70
export async function refundBankTransaction(
  bankTxnId: number,
  body: RefundBankTransactionInput,
): Promise<RefundBankTransactionResponse> {
  const res = await apiFetch<ApiSuccess<RefundBankTransactionResponse>>(
    `/reconciliation/transactions/${bankTxnId}/refund-to-customer`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-71
export async function ignoreBankTransaction(
  bankTxnId: number,
  body?: IgnoreBankTransactionInput,
): Promise<IgnoreBankTransactionResponse> {
  const res = await apiFetch<ApiSuccess<IgnoreBankTransactionResponse>>(
    `/reconciliation/transactions/${bankTxnId}/ignore`,
    {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    },
  );
  return res.data;
}

// API-72
export async function getRefunds(params?: GetRefundsParams): Promise<RefundItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (params?.status) {
    search.set('status', params.status);
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<RefundItem[]>>(qs ? `/refunds?${qs}` : '/refunds');
  return res.data;
}

// API-73 (complete)
export async function completeRefund(
  refundId: number,
  body?: UpdateRefundStatusInput,
): Promise<UpdateRefundStatusResponse> {
  const res = await apiFetch<ApiSuccess<UpdateRefundStatusResponse>>(
    `/refunds/${refundId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    },
  );
  return res.data;
}

// API-73 (fail)
export async function failRefund(
  refundId: number,
  body?: UpdateRefundStatusInput,
): Promise<UpdateRefundStatusResponse> {
  const res = await apiFetch<ApiSuccess<UpdateRefundStatusResponse>>(
    `/refunds/${refundId}/fail`,
    {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    },
  );
  return res.data;
}

export function useReconciliationTransactions(
  params?: GetReconciliationTransactionsParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: reconciliationKeys.transactions(params),
    queryFn: () => getReconciliationTransactions(params),
    enabled: options?.enabled ?? true,
  });
}

export function useReconciliationCandidates(
  bankTxnId: number | null | undefined,
  params?: GetReconciliationCandidatesParams,
  options?: { enabled?: boolean },
) {
  const isValidId = typeof bankTxnId === 'number' && bankTxnId > 0;
  return useQuery({
    queryKey: reconciliationKeys.candidates(bankTxnId, params),
    queryFn: () => getReconciliationCandidates(bankTxnId as number, params),
    enabled: isValidId && (options?.enabled ?? true),
  });
}

export function useRefunds(params?: GetRefundsParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: reconciliationKeys.refunds(params),
    queryFn: () => getRefunds(params),
    enabled: options?.enabled ?? true,
  });
}
