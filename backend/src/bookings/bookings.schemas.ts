import { BOOKING_STATUSES, PAYMENT_OPTIONS } from '@sporthub/shared/enums';
import {
  isoDateSchema,
  paginationSchema,
  reasonSchema,
  timeHHmmSchema,
} from '@sporthub/shared/validators';
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

export const createOnlineBookingSchema = z
  .object({
    courtId: z.number().int().positive('courtId phải là số nguyên dương.'),
    date: validIsoDateSchema,
    startTime: timeHHmmSchema,
    endTime: timeHHmmSchema,
    paymentOption: z.enum(PAYMENT_OPTIONS),
    promotionCode: z.string().trim().toUpperCase().nullable().optional(),
    note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự.').nullable().optional(),
  })
  .refine((val) => val.startTime < val.endTime, {
    message: 'Giờ kết thúc phải sau giờ bắt đầu.',
    path: ['endTime'],
  });

export type CreateOnlineBookingDto = z.infer<typeof createOnlineBookingSchema>;

export const bookingCodeParamSchema = z.object({
  bookingCode: z.string().trim().min(1, 'Mã đơn đặt sân không được để trống.'),
});

export type BookingCodeParam = z.infer<typeof bookingCodeParamSchema>;

export const myBookingsQuerySchema = z.object({
  from: validIsoDateSchema,
  to: validIsoDateSchema,
  status: z.enum(['ALL', ...BOOKING_STATUSES]).default('ALL'),
  ...paginationSchema.shape,
});

export type MyBookingsQuery = z.infer<typeof myBookingsQuerySchema>;

export const cancelPreviewQuerySchema = z.object({
  cancelType: z.enum(['CUSTOMER_REQUEST', 'NO_SHOW']).default('CUSTOMER_REQUEST'),
});

export type CancelPreviewQuery = z.infer<typeof cancelPreviewQuerySchema>;

export const cancelBookingSchema = z.object({
  cancelType: z.enum(['CUSTOMER_REQUEST', 'NO_SHOW']).default('CUSTOMER_REQUEST'),
  reason: reasonSchema,
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type CancelBookingDto = z.infer<typeof cancelBookingSchema>;
