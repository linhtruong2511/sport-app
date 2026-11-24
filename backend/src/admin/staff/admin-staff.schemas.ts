import { USER_STATUSES } from '@sporthub/shared/enums';
import {
  emailSchema,
  fullNameSchema,
  isoDateSchema,
  paginationSchema,
  phoneSchema,
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

const staffPasswordSchema = z
  .string({
    required_error: 'Vui lòng nhập mật khẩu.',
    invalid_type_error: 'Mật khẩu không hợp lệ.',
  })
  .min(8, 'Mật khẩu phải từ 8 đến 32 ký tự.')
  .max(32, 'Mật khẩu phải từ 8 đến 32 ký tự.')
  .refine((val) => !/\s/.test(val), 'Mật khẩu không được chứa khoảng trắng.')
  .refine(
    (val) => /[A-Za-z]/.test(val) && /\d/.test(val),
    'Mật khẩu phải chứa ít nhất 1 chữ cái và 1 chữ số.',
  );

const optionalEmailSchema = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
  emailSchema.nullable().optional(),
);

export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive('Mã nhân viên không hợp lệ.'),
});

export const listStaffQuerySchema = z.object({
  branchId: z.coerce.number().int().positive('Mã chi nhánh không hợp lệ.').optional(),
  status: z.enum(USER_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(100, 'Từ khóa tìm kiếm tối đa 100 ký tự.')
    .transform((val) => (val.length > 0 ? val : undefined))
    .optional(),
  page: paginationSchema.shape.page,
  pageSize: paginationSchema.shape.pageSize,
});

export const createStaffSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  branchId: z
    .number({
      required_error: 'Vui lòng chọn chi nhánh phân công.',
      invalid_type_error: 'Mã chi nhánh không hợp lệ.',
    })
    .int('Mã chi nhánh không hợp lệ.')
    .positive('Mã chi nhánh không hợp lệ.'),
  password: staffPasswordSchema,
  status: z.enum(USER_STATUSES).default('ACTIVE'),
});

export const updateStaffSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  branchId: z
    .number({
      required_error: 'Vui lòng chọn chi nhánh phân công.',
      invalid_type_error: 'Mã chi nhánh không hợp lệ.',
    })
    .int('Mã chi nhánh không hợp lệ.')
    .positive('Mã chi nhánh không hợp lệ.'),
  password: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    staffPasswordSchema.nullable().optional(),
  ),
  status: z.enum(USER_STATUSES).optional(),
});

export const staffPaymentsQuerySchema = z.object({
  from: isoDateSchema.refine(isValidCalendarDate, 'Ngày bắt đầu không hợp lệ.').optional(),
  to: isoDateSchema.refine(isValidCalendarDate, 'Ngày kết thúc không hợp lệ.').optional(),
  page: paginationSchema.shape.page,
  pageSize: paginationSchema.shape.pageSize,
});

export type UserIdParam = z.infer<typeof userIdParamSchema>;
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;
export type CreateStaffDto = z.infer<typeof createStaffSchema>;
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;
export type StaffPaymentsQuery = z.infer<typeof staffPaymentsQuerySchema>;
