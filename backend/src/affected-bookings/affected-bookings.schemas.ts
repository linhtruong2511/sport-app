import { isoDateSchema, timeHHmmSchema } from '@sporthub/shared/validators';
import { z } from 'zod';

export const affectedListQuerySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
});

export const bookingCodeParamSchema = z.object({
  bookingCode: z.string().trim().min(1, 'Mã đơn không hợp lệ.'),
});

export const reassignOptionsQuerySchema = z
  .object({
    date: isoDateSchema.optional(),
    startTime: timeHHmmSchema.optional(),
    endTime: timeHHmmSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if ((val.startTime && !val.endTime) || (!val.startTime && val.endTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startTime'],
        message: 'Phải truyền cả startTime và endTime.',
      });
    }
    if (val.startTime && val.endTime && val.startTime >= val.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'Giờ kết thúc phải sau giờ bắt đầu.',
      });
    }
  });

export const reassignBookingSchema = z
  .object({
    newCourtId: z.number().int().positive(),
    date: isoDateSchema,
    startTime: timeHHmmSchema,
    endTime: timeHHmmSchema,
    note: z.string().trim().max(255, 'Ghi chú tối đa 255 ký tự.').nullable().optional(),
    version: z.string().min(1, 'Thiếu version của đơn.'),
  })
  .refine((val) => val.startTime < val.endTime, {
    path: ['endTime'],
    message: 'Giờ kết thúc phải sau giờ bắt đầu.',
  });

export const closeAffectedBookingSchema = z.object({
  note: z.string().trim().max(255, 'Ghi chú tối đa 255 ký tự.').nullable().optional(),
  version: z.string().min(1, 'Thiếu version của đơn.'),
});

export type AffectedListQuery = z.infer<typeof affectedListQuerySchema>;
export type ReassignOptionsQuery = z.infer<typeof reassignOptionsQuerySchema>;
export type ReassignBookingDto = z.infer<typeof reassignBookingSchema>;
export type CloseAffectedBookingDto = z.infer<typeof closeAffectedBookingSchema>;
