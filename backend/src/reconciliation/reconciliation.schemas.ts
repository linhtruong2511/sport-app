import { BANK_MATCH_STATUSES, REFUND_STATUSES } from '@sporthub/shared/enums';
import { isoDateSchema, paginationSchema } from '@sporthub/shared/validators';
import { z } from 'zod';
import { toSqlDate } from '../core/time.js';

const validIsoDateSchema = isoDateSchema.refine((d) => {
  try {
    toSqlDate(d);
    return true;
  } catch {
    return false;
  }
}, 'Ngày không hợp lệ.');

export const RECONCILIATION_STATUS_FILTERS = ['ALL', ...BANK_MATCH_STATUSES] as const;
export type ReconciliationStatusFilter = (typeof RECONCILIATION_STATUS_FILTERS)[number];

export const REFUND_STATUS_FILTERS = ['ALL', ...REFUND_STATUSES] as const;
export type RefundStatusFilter = (typeof REFUND_STATUS_FILTERS)[number];

export const bankTxnIdParamSchema = z.object({
  bankTxnId: z.coerce.number().int().positive('bankTxnId phải là số nguyên dương.'),
});

export type BankTxnIdParam = z.infer<typeof bankTxnIdParamSchema>;

export const refundIdParamSchema = z.object({
  refundId: z.coerce.number().int().positive('refundId phải là số nguyên dương.'),
});

export type RefundIdParam = z.infer<typeof refundIdParamSchema>;

export const listBankTransactionsQuerySchema = paginationSchema.extend({
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(RECONCILIATION_STATUS_FILTERS).default('NEEDS_REVIEW'),
  from: validIsoDateSchema.optional(),
  to: validIsoDateSchema.optional(),
});

export type ListBankTransactionsQuery = z.infer<typeof listBankTransactionsQuerySchema>;

export const listCandidatesQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export type ListCandidatesQuery = z.infer<typeof listCandidatesQuerySchema>;

export const matchBankTransactionSchema = z.object({
  bookingCode: z
    .string()
    .trim()
    .min(1, 'Mã đơn đặt sân không được để trống.')
    .max(20, 'Mã đơn đặt sân tối đa 20 ký tự.'),
  note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').nullable().optional(),
});

export type MatchBankTransactionDto = z.infer<typeof matchBankTransactionSchema>;

export const refundToCustomerSchema = z.object({
  note: z
    .string()
    .trim()
    .min(3, 'Vui lòng nhập ghi chú hoàn tiền (tối thiểu 3 ký tự).')
    .max(500, 'Ghi chú tối đa 500 ký tự.'),
});

export type RefundToCustomerDto = z.infer<typeof refundToCustomerSchema>;

export const ignoreBankTransactionSchema = z
  .object({
    note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').nullable().optional(),
  })
  .optional()
  .default({});

export type IgnoreBankTransactionDto = z.infer<typeof ignoreBankTransactionSchema>;

export const listRefundsQuerySchema = paginationSchema.extend({
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(REFUND_STATUS_FILTERS).default('PENDING'),
  from: validIsoDateSchema.optional(),
  to: validIsoDateSchema.optional(),
});

export type ListRefundsQuery = z.infer<typeof listRefundsQuerySchema>;

export const completeRefundSchema = z
  .object({
    note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').nullable().optional(),
  })
  .optional()
  .default({});

export type CompleteRefundDto = z.infer<typeof completeRefundSchema>;

export const failRefundSchema = z.object({
  note: z
    .string()
    .trim()
    .min(3, 'Vui lòng nhập lý do hoàn tiền thất bại (tối thiểu 3 ký tự).')
    .max(500, 'Ghi chú tối đa 500 ký tự.'),
});

export type FailRefundDto = z.infer<typeof failRefundSchema>;
