import { z } from 'zod';
import { validIsoDateSchema } from '../availability/availability.schemas.js';

export const branchesQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'ALL']).default('ACTIVE'),
});

export const sportsQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('branchId phải là số nguyên dương.').optional(),
});

export const branchIdParamSchema = z.object({
  branchId: z.coerce.number().int().positive('branchId phải là số nguyên dương.'),
});

export const sportSummaryQuerySchema = z.object({
  date: validIsoDateSchema.optional(),
});

export type BranchesQuery = z.infer<typeof branchesQuerySchema>;
export type SportsQuery = z.infer<typeof sportsQuerySchema>;
export type BranchIdParam = z.infer<typeof branchIdParamSchema>;
export type SportSummaryQuery = z.infer<typeof sportSummaryQuerySchema>;
