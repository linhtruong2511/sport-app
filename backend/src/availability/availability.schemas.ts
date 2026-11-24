import { z } from 'zod';
import { isoDateSchema } from '@sporthub/shared/validators';
import { toSqlDate } from '../core/time.js';

export const validIsoDateSchema = isoDateSchema.refine((val) => {
  try {
    toSqlDate(val);
    return true;
  } catch {
    return false;
  }
}, 'Ngày không hợp lệ.');

export const availabilityQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('branchId phải là số nguyên dương.'),
  sportId: z.coerce.number().int().positive('sportId phải là số nguyên dương.'),
  date: validIsoDateSchema,
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
