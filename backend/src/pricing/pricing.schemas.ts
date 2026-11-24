import { BOOKING_CHANNELS, PAYMENT_OPTIONS } from '@sporthub/shared/enums';
import { isoDateSchema, phoneSchema, timeHHmmSchema } from '@sporthub/shared/validators';
import { z } from 'zod';
import { toSqlDate } from '../core/time.js';

export const quoteRequestSchema = z
  .object({
    courtId: z.number().int().positive('courtId phải là số nguyên dương.'),
    date: isoDateSchema.refine((d) => {
      try {
        toSqlDate(d);
        return true;
      } catch {
        return false;
      }
    }, 'Ngày đặt sân không hợp lệ.'),
    startTime: timeHHmmSchema,
    endTime: timeHHmmSchema,
    promotionCode: z.string().trim().toUpperCase().optional(),
    paymentOption: z.enum(PAYMENT_OPTIONS).default('FULL'),
    channel: z.enum(BOOKING_CHANNELS).default('ONLINE'),
    customerPhone: phoneSchema.optional(),
  })
  .refine((val) => val.startTime < val.endTime, {
    message: 'Giờ kết thúc phải sau giờ bắt đầu.',
    path: ['endTime'],
  });

export type QuoteRequestDto = z.infer<typeof quoteRequestSchema>;
