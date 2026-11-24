import { AUDIENCE_TYPES, DISCOUNT_TYPES, PROMOTION_STATUSES } from '@sporthub/shared/enums';
import {
  isoDateSchema,
  paginationSchema,
  phoneSchema,
  promoCodeSchema,
  promoNameSchema,
  timeHHmmSchema,
} from '@sporthub/shared/validators';
import { z } from 'zod';
import { toSqlDate } from '../../core/time.js';

function isValidCalendarDate(dateStr: string): boolean {
  try {
    toSqlDate(dateStr);
    return true;
  } catch {
    return false;
  }
}

export const promotionIdParamSchema = z.object({
  promotionId: z.coerce.number().int().positive('Mã chương trình khuyến mãi không hợp lệ.'),
});

export const listPromotionsQuerySchema = z.object({
  status: z.enum(PROMOTION_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(150, 'Từ khóa tìm kiếm tối đa 150 ký tự.')
    .transform((val) => (val.length > 0 ? val : undefined))
    .optional(),
  audienceType: z.enum(AUDIENCE_TYPES).optional(),
  page: paginationSchema.shape.page,
  pageSize: paginationSchema.shape.pageSize,
});

const promotionPayloadSchema = z
  .object({
    name: promoNameSchema,
    code: promoCodeSchema,
    description: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
      z.string().trim().max(1000, 'Mô tả tối đa 1000 ký tự.').nullable().optional(),
    ),
    discountType: z.enum(DISCOUNT_TYPES),
    discountValue: z
      .number({
        required_error: 'Vui lòng nhập giá trị giảm.',
        invalid_type_error: 'Giá trị giảm phải là số hợp lệ.',
      })
      .finite('Giá trị giảm phải là số hợp lệ.'),
    maxDiscountAmount: z.preprocess(
      (val) => (val === '' || val === undefined ? null : val),
      z
        .number({ invalid_type_error: 'Trần giảm tối đa phải là số hợp lệ.' })
        .int('Trần giảm tối đa phải là số nguyên.')
        .positive('Trần giảm tối đa phải lớn hơn 0.')
        .nullable()
        .optional(),
    ),
    allBranches: z.boolean(),
    branchIds: z.array(z.number().int().positive('Mã chi nhánh không hợp lệ.')).default([]),
    allSports: z.boolean(),
    sportIds: z.array(z.number().int().positive('Mã bộ môn không hợp lệ.')).default([]),
    timeFrom: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
      timeHHmmSchema.nullable().optional(),
    ),
    timeTo: z.preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
      timeHHmmSchema.nullable().optional(),
    ),
    startDate: isoDateSchema.refine(isValidCalendarDate, 'Ngày bắt đầu áp dụng không hợp lệ.'),
    endDate: isoDateSchema.refine(isValidCalendarDate, 'Ngày kết thúc áp dụng không hợp lệ.'),
    maxUses: z
      .number({
        required_error: 'Vui lòng nhập tổng lượt sử dụng.',
        invalid_type_error: 'Tổng lượt sử dụng phải là số hợp lệ.',
      })
      .int('Tổng lượt sử dụng phải là số nguyên.')
      .positive('Tổng lượt sử dụng tối đa phải lớn hơn 0.'),
    audienceType: z.enum(AUDIENCE_TYPES),
    customerPhones: z.array(phoneSchema).default([]),
    notifyCustomers: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.discountType === 'PERCENT') {
      if (val.discountValue < 1 || val.discountValue > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountValue'],
          message: 'Mức giảm phần trăm phải từ 1% đến 100%.',
        });
      }
    } else if (val.discountValue <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'Số tiền giảm cố định phải lớn hơn 0.',
      });
    }

    if (!val.allBranches && val.branchIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchIds'],
        message: 'Vui lòng chọn ít nhất 1 chi nhánh áp dụng.',
      });
    }

    if (!val.allSports && val.sportIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sportIds'],
        message: 'Vui lòng chọn ít nhất 1 bộ môn áp dụng.',
      });
    }

    const hasFrom = val.timeFrom !== undefined && val.timeFrom !== null;
    const hasTo = val.timeTo !== undefined && val.timeTo !== null;
    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasFrom ? 'timeTo' : 'timeFrom'],
        message: 'Khung giờ tùy chỉnh phải có đủ giờ bắt đầu và giờ kết thúc.',
      });
    } else if (hasFrom && hasTo && val.timeFrom! >= val.timeTo!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeTo'],
        message: 'Khung giờ tùy chỉnh không hợp lệ (giờ kết thúc phải sau giờ bắt đầu).',
      });
    }

    if (val.startDate > val.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Khoảng ngày áp dụng không hợp lệ.',
      });
    }

    if (val.audienceType === 'SPECIFIC' && val.customerPhones.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerPhones'],
        message: 'Vui lòng nhập ít nhất 1 số điện thoại khách hàng được chỉ định.',
      });
    }
  });

export const createPromotionSchema = promotionPayloadSchema;
export const updatePromotionSchema = promotionPayloadSchema;

export type PromotionIdParam = z.infer<typeof promotionIdParamSchema>;
export type ListPromotionsQuery = z.infer<typeof listPromotionsQuerySchema>;
export type CreatePromotionDto = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionDto = z.infer<typeof updatePromotionSchema>;
