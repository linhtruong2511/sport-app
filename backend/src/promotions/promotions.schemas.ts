import { z } from 'zod';

export const publicPromotionsQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('branchId phải là số nguyên dương.').optional(),
  sportId: z.coerce.number().int().positive('sportId phải là số nguyên dương.').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const publicPromoCodeParamSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Mã khuyến mãi không được để trống.')
    .max(50, 'Mã khuyến mãi không hợp lệ.')
    .toUpperCase(),
});

export type PublicPromotionsQuery = z.infer<typeof publicPromotionsQuerySchema>;
export type PublicPromoCodeParam = z.infer<typeof publicPromoCodeParamSchema>;
