import { isoDateSchema } from '@sporthub/shared/validators';
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

const optionalIdFilterSchema = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z
    .union([
      z.literal('all'),
      z.coerce.number().int().positive('Mã định danh phải là số nguyên dương hoặc all.'),
    ])
    .optional(),
);

export const revenueReportQuerySchema = z.object({
  from: validIsoDateSchema,
  to: validIsoDateSchema,
  branchId: optionalIdFilterSchema,
  courtId: optionalIdFilterSchema,
});

export type RevenueReportQuery = z.infer<typeof revenueReportQuerySchema>;
