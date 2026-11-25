import { PAYMENT_OPTIONS } from '@sporthub/shared/enums';
import { isoDateSchema, phoneSchema, timeHHmmSchema } from '@sporthub/shared/validators';
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

export const POS_BOOKING_TABS = [
  'ALL',
  'WAITING',
  'IN_USE',
  'OVERDUE',
  'PENDING_PAYMENT',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
] as const;

export type PosBookingTab = (typeof POS_BOOKING_TABS)[number];

export const bookingCodeParamSchema = z.object({
  bookingCode: z.string().trim().min(1, 'Mã đơn đặt sân không được để trống.'),
});

export type BookingCodeParam = z.infer<typeof bookingCodeParamSchema>;

export const posScheduleQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  date: validIsoDateSchema,
  sportId: z.coerce.number().int().positive().optional(),
});

export type PosScheduleQuery = z.infer<typeof posScheduleQuerySchema>;

export const posCustomerLookupSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^0\d{9}$/, 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).'),
});

export type PosCustomerLookupQuery = z.infer<typeof posCustomerLookupSchema>;

export const posPromotionsQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  courtId: z.coerce.number().int().positive().optional(),
  date: validIsoDateSchema.optional(),
  startTime: timeHHmmSchema.optional(),
  endTime: timeHHmmSchema.optional(),
  customerPhone: phoneSchema.optional(),
});

export type PosPromotionsQuery = z.infer<typeof posPromotionsQuerySchema>;

export const createPosBookingSchema = z
  .object({
    branchId: z.number().int().positive('branchId phải là số nguyên dương.'),
    courtId: z.number().int().positive('courtId phải là số nguyên dương.'),
    date: validIsoDateSchema,
    startTime: timeHHmmSchema,
    endTime: timeHHmmSchema,
    customer: z.object({
      type: z.enum(['GUEST', 'MEMBER']),
      userId: z.number().int().positive().nullable().optional(),
      phone: z.string().trim().optional(),
      fullName: z.string().trim().optional(),
    }),
    promotionCode: z.string().trim().toUpperCase().nullable().optional(),
    paymentOption: z.enum(PAYMENT_OPTIONS),
    payment: z
      .object({
        method: z.literal('CASH'),
        amount: z.number().int().nonnegative(),
      })
      .nullable()
      .optional(),
    note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startTime >= val.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'Giờ kết thúc phải sau giờ bắt đầu.',
      });
    }

    if (val.customer.type === 'GUEST') {
      const phoneResult = phoneSchema.safeParse(val.customer.phone ?? '');
      if (!phoneResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customer', 'phone'],
          message: 'Số điện thoại khách không hợp lệ (10 chữ số).',
        });
      }

      const name = (val.customer.fullName ?? '').trim();
      if (name.length < 2 || name.length > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customer', 'fullName'],
          message: 'Vui lòng nhập họ và tên khách.',
        });
      }
    }
  });

export type CreatePosBookingDto = z.infer<typeof createPosBookingSchema>;

export const posCashPaymentSchema = z.object({
  method: z.literal('CASH'),
  amount: z.number().int().positive('Số tiền thanh toán phải lớn hơn 0.'),
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type PosCashPaymentDto = z.infer<typeof posCashPaymentSchema>;

export const posAbortSchema = z.object({
  reason: z.string().trim().max(255, 'Lý do hủy tối đa 255 ký tự.').optional(),
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type PosAbortDto = z.infer<typeof posAbortSchema>;

export const posLatestReceiptQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
});

export type PosLatestReceiptQuery = z.infer<typeof posLatestReceiptQuerySchema>;

export const posBookingsListQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  date: validIsoDateSchema,
  tab: z.enum(POS_BOOKING_TABS).default('ALL'),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type PosBookingsListQuery = z.infer<typeof posBookingsListQuerySchema>;

export const posSettleSchema = z.object({
  method: z.literal('CASH'),
  amount: z.number().int().positive('Số tiền thanh toán phải lớn hơn 0.'),
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type PosSettleDto = z.infer<typeof posSettleSchema>;

export const posCheckInSchema = z.object({
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type PosCheckInDto = z.infer<typeof posCheckInSchema>;

export const posCompleteSchema = z.object({
  note: z.string().trim().max(255, 'Ghi chú tối đa 255 ký tự.').nullable().optional(),
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type PosCompleteDto = z.infer<typeof posCompleteSchema>;
