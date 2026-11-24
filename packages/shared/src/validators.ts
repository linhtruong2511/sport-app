import { z } from 'zod';
import { DEPOSIT_TYPES, DISCOUNT_TYPES } from './enums.js';

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^0\d{9}$/, 'Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.');

export const emailSchema = z
  .string()
  .trim()
  .refine((val) => !/\s/.test(val), 'Email không được chứa khoảng trắng.')
  .pipe(z.string().email('Email không đúng định dạng.').max(255, 'Email tối đa 255 ký tự.'));

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Họ tên phải từ 2 đến 100 ký tự.')
  .max(100, 'Họ tên phải từ 2 đến 100 ký tự.')
  .regex(
    /^[\p{L}\s]+$/u,
    'Họ tên chỉ được chứa chữ cái và khoảng trắng.',
  );

export const passwordSchema = z
  .string()
  .min(6, 'Mật khẩu phải từ 6 đến 32 ký tự.')
  .max(32, 'Mật khẩu phải từ 6 đến 32 ký tự.')
  .refine((val) => !/\s/.test(val), 'Mật khẩu không được chứa khoảng trắng.');

export const promoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,20}$/, 'Mã khuyến mãi phải gồm 4–20 ký tự chữ in hoa hoặc số.');

export const promoNameSchema = z
  .string()
  .trim()
  .min(5, 'Tên chương trình phải từ 5 đến 150 ký tự.')
  .max(150, 'Tên chương trình phải từ 5 đến 150 ký tự.');

export const reasonSchema = z
  .string()
  .trim()
  .min(1, 'Lý do/ghi chú không được để trống.')
  .max(255, 'Lý do/ghi chú tối đa 255 ký tự.');

export const courtNameSchema = z
  .string()
  .trim()
  .min(1, 'Tên sân không được để trống.')
  .max(100, 'Tên sân tối đa 100 ký tự.');

export const courtDescriptionSchema = z
  .string()
  .trim()
  .max(500, 'Mô tả sân tối đa 500 ký tự.');

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD.');

export const timeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có định dạng HH:mm.');

export const uuidV4Schema = z
  .string()
  .uuid('Giá trị phải là UUID hợp lệ.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1, 'Số trang phải >= 1.').default(1),
  pageSize: z.coerce.number().int().min(1).max(100, 'Kích thước trang tối đa 100.').default(20),
});

export const depositConfigSchema = z
  .object({
    depositType: z.enum(DEPOSIT_TYPES),
    depositValue: z.number(),
  })
  .superRefine((val, ctx) => {
    if (val.depositType === 'PERCENT') {
      if (val.depositValue < 10 || val.depositValue > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['depositValue'],
          message: 'Tỷ lệ cọc phải từ 10% đến 100%.',
        });
      }
    } else if (val.depositValue <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['depositValue'],
        message: 'Số tiền cọc cố định phải lớn hơn 0.',
      });
    }
  });

export const discountConfigSchema = z
  .object({
    discountType: z.enum(DISCOUNT_TYPES),
    discountValue: z.number(),
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
  });
