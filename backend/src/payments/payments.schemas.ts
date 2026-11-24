import { PAYMENT_PURPOSES } from '@sporthub/shared/enums';
import { z } from 'zod';

export const bookingCodeParamSchema = z.object({
  bookingCode: z.string().trim().min(1),
});

export const requestIdParamSchema = z.object({
  requestId: z.coerce.number().int().positive(),
});

export const providerParamSchema = z.object({
  provider: z.enum(['sepay']),
});

export const createPaymentRequestSchema = z.preprocess(
  (val) => (val === undefined ? {} : val),
  z.object({
    purpose: z.enum(PAYMENT_PURPOSES).nullable().optional(),
  }),
);

export const sepayWebhookSchema = z.object({
  id: z.union([z.number(), z.string()]),
  gateway: z.string().nullable().optional(),
  transactionDate: z.string(),
  accountNumber: z.string().trim().min(1),
  code: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  transferType: z.string(),
  transferAmount: z.coerce.number().int().nonnegative(),
  accumulated: z.coerce.number().nullable().optional(),
  subAccount: z.string().nullable().optional(),
  referenceCode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export type BookingCodeParamDto = z.infer<typeof bookingCodeParamSchema>;
export type RequestIdParamDto = z.infer<typeof requestIdParamSchema>;
export type ProviderParamDto = z.infer<typeof providerParamSchema>;
export type CreatePaymentRequestDto = z.infer<typeof createPaymentRequestSchema>;
export type SepayWebhookDto = z.infer<typeof sepayWebhookSchema>;
