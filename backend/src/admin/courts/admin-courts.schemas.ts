import { BLOCK_TYPES, COURT_STATUSES, DEPOSIT_TYPES } from '@sporthub/shared/enums';
import {
  courtDescriptionSchema,
  courtNameSchema,
  isoDateSchema,
  timeHHmmSchema,
} from '@sporthub/shared/validators';
import { z } from 'zod';
import { fromSqlDateTime, toSqlDate } from '../../core/time.js';

function isValidCalendarDate(dateStr: string): boolean {
  try {
    toSqlDate(dateStr);
    return true;
  } catch {
    return false;
  }
}

function isValidIsoDateTime(val: string): boolean {
  const trimmed = val.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[zZ]|[+-]\d{2}:?\d{2})?$/.test(
      trimmed,
    )
  ) {
    return false;
  }
  try {
    fromSqlDateTime(trimmed);
    return true;
  } catch {
    return false;
  }
}

export const listCourtsQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('Mã chi nhánh không hợp lệ.').optional(),
  sportId: z.coerce.number().int().positive('Mã bộ môn không hợp lệ.').optional(),
  status: z.enum(COURT_STATUSES).optional(),
});

export const courtIdParamSchema = z.object({
  courtId: z.coerce.number().int().positive('Mã sân không hợp lệ.'),
});

export const blockIdParamSchema = z.object({
  blockId: z.coerce.number().int().positive('Mã khóa sân không hợp lệ.'),
});

export const branchIdParamSchema = z.object({
  branchId: z.coerce.number().int().positive('Mã chi nhánh không hợp lệ.'),
});

export const holidayIdParamSchema = z.object({
  holidayId: z.coerce.number().int().positive('Mã ngày nghỉ không hợp lệ.'),
});

export const priceRuleInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Tên khung giá không được để trống.')
    .max(50, 'Tên khung giá tối đa 50 ký tự.'),
  dayOfWeekMask: z.number().int().min(1).max(127).default(127),
  startTime: timeHHmmSchema,
  endTime: timeHHmmSchema,
  pricePerHour: z.number().finite('Đơn giá phải là số hợp lệ.'),
});

export const createCourtSchema = z.object({
  name: courtNameSchema,
  branchId: z.number().int().positive('Mã chi nhánh không hợp lệ.'),
  sportId: z.number().int().positive('Mã bộ môn không hợp lệ.'),
  courtType: z.string().trim().max(50, 'Loại sân tối đa 50 ký tự.').nullable().optional(),
  description: courtDescriptionSchema.nullable().optional(),
  depositType: z.enum(DEPOSIT_TYPES),
  depositValue: z.number().finite('Giá trị đặt cọc phải là số hợp lệ.'),
  status: z.enum(COURT_STATUSES).default('ACTIVE'),
  priceRules: z.array(priceRuleInputSchema).min(1, 'Bảng giá phải có ít nhất 1 khung giờ.'),
});

export const updateCourtSchema = z.object({
  name: courtNameSchema,
  branchId: z.number().int().positive('Mã chi nhánh không hợp lệ.'),
  sportId: z.number().int().positive('Mã bộ môn không hợp lệ.').optional(),
  courtType: z.string().trim().max(50, 'Loại sân tối đa 50 ký tự.').nullable().optional(),
  description: courtDescriptionSchema.nullable().optional(),
  depositType: z.enum(DEPOSIT_TYPES),
  depositValue: z.number().finite('Giá trị đặt cọc phải là số hợp lệ.'),
  status: z.enum(COURT_STATUSES).default('ACTIVE'),
  priceRules: z.array(priceRuleInputSchema).min(1, 'Bảng giá phải có ít nhất 1 khung giờ.'),
});

export const listBlocksQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('Mã chi nhánh không hợp lệ.').optional(),
  active: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const dryRunQuerySchema = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const createCourtBlockSchema = z
  .object({
    courtId: z
      .number({
        required_error: 'Vui lòng chọn sân cần khóa.',
        invalid_type_error: 'Vui lòng chọn sân cần khóa.',
      })
      .int('Vui lòng chọn sân cần khóa.')
      .positive('Vui lòng chọn sân cần khóa.'),
    blockType: z.enum(BLOCK_TYPES),
    startAt: z
      .string({ required_error: 'Vui lòng chọn thời gian bắt đầu.' })
      .trim()
      .min(1, 'Vui lòng chọn thời gian bắt đầu.')
      .refine(isValidIsoDateTime, 'Thời gian bắt đầu không hợp lệ.'),
    endAt: z.string().trim().min(1).nullable().optional(),
    reason: z
      .string({ required_error: 'Vui lòng nhập lý do khóa sân.' })
      .trim()
      .min(1, 'Vui lòng nhập lý do khóa sân.')
      .max(255, 'Lý do/ghi chú tối đa 255 ký tự.'),
  })
  .superRefine((val, ctx) => {
    if (val.blockType === 'MAINTENANCE') {
      if (!val.endAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endAt'],
          message: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
        });
        return;
      }
      if (!isValidIsoDateTime(val.endAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endAt'],
          message: 'Thời gian kết thúc không hợp lệ.',
        });
        return;
      }
      if (
        isValidIsoDateTime(val.startAt) &&
        fromSqlDateTime(val.endAt).getTime() <= fromSqlDateTime(val.startAt).getTime()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endAt'],
          message: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
        });
      }
    } else if (val.endAt !== undefined && val.endAt !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endAt'],
        message: 'Khóa ngừng khai thác phải để trống thời gian kết thúc.',
      });
    }
  });

export const openingHoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  openTime: timeHHmmSchema.nullable(),
  closeTime: timeHHmmSchema.nullable(),
  isClosed: z.boolean(),
});

export const updateOpeningHoursSchema = z.object({
  days: z.array(openingHoursDaySchema).length(7, 'Phải cung cấp đủ 7 ngày trong tuần.'),
});

export const listHolidaysQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('Mã chi nhánh không hợp lệ.').optional(),
  from: isoDateSchema.refine(isValidCalendarDate, 'Ngày tra cứu không hợp lệ.').optional(),
});

export const createHolidaySchema = z
  .object({
    startDate: isoDateSchema.refine(isValidCalendarDate, 'Ngày bắt đầu nghỉ không hợp lệ.'),
    days: z
      .number()
      .int('Số ngày nghỉ liên tiếp phải từ 1 đến 60.')
      .min(1, 'Số ngày nghỉ liên tiếp phải từ 1 đến 60.')
      .max(60, 'Số ngày nghỉ liên tiếp phải từ 1 đến 60.'),
    scope: z.enum(['ALL', 'BRANCH']),
    branchId: z.number().int().positive('Mã chi nhánh không hợp lệ.').nullable().optional(),
    reason: z.string().trim().max(255, 'Lý do/ghi chú tối đa 255 ký tự.').nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === 'BRANCH' && !val.branchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchId'],
        message: 'Vui lòng chọn chi nhánh áp dụng ngày nghỉ.',
      });
    }
  });

export const deleteHolidayQuerySchema = z.object({
  group: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListCourtsQuery = z.infer<typeof listCourtsQuerySchema>;
export type PriceRuleInputDto = z.infer<typeof priceRuleInputSchema>;
export type CreateCourtDto = z.infer<typeof createCourtSchema>;
export type UpdateCourtDto = z.infer<typeof updateCourtSchema>;
export type ListBlocksQuery = z.infer<typeof listBlocksQuerySchema>;
export type DryRunQuery = z.infer<typeof dryRunQuerySchema>;
export type CreateCourtBlockDto = z.infer<typeof createCourtBlockSchema>;
export type OpeningHoursDayDto = z.infer<typeof openingHoursDaySchema>;
export type UpdateOpeningHoursDto = z.infer<typeof updateOpeningHoursSchema>;
export type ListHolidaysQuery = z.infer<typeof listHolidaysQuerySchema>;
export type CreateHolidayDto = z.infer<typeof createHolidaySchema>;
export type DeleteHolidayQuery = z.infer<typeof deleteHolidayQuerySchema>;
