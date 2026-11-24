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

const branchIdFilterSchema = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z
    .union([
      z.literal('all'),
      z.coerce.number().int().positive('branchId phải là số nguyên dương hoặc all.'),
    ])
    .optional(),
);

export const DASHBOARD_KPIS = ['TOTAL', 'PLAYING', 'PENDING', 'REVENUE'] as const;
export type DashboardKpi = (typeof DASHBOARD_KPIS)[number];

export const dailyDashboardQuerySchema = z.object({
  branchId: branchIdFilterSchema,
  date: validIsoDateSchema.optional(),
});

export type DailyDashboardQuery = z.infer<typeof dailyDashboardQuerySchema>;

export const dailyBookingsQuerySchema = z.object({
  branchId: branchIdFilterSchema,
  date: validIsoDateSchema.optional(),
  kpi: z.enum(DASHBOARD_KPIS),
});

export type DailyBookingsQuery = z.infer<typeof dailyBookingsQuerySchema>;
