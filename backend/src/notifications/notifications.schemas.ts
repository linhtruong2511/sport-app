import { NOTIFICATION_TYPES } from '@sporthub/shared/enums';
import { paginationSchema } from '@sporthub/shared/validators';
import { z } from 'zod';

export const listNotificationsQuerySchema = paginationSchema.extend({
  type: z.enum(NOTIFICATION_TYPES).optional(),
  isRead: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const notificationIdParamSchema = z.object({
  notificationId: z.coerce
    .number()
    .int('notificationId phải là số nguyên.')
    .positive('notificationId phải là số nguyên dương.'),
});

export const markNotificationReadSchema = z.object({
  isRead: z.literal(true, {
    errorMap: () => ({ message: 'isRead chỉ nhận giá trị true.' }),
  }),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type NotificationIdParam = z.infer<typeof notificationIdParamSchema>;
export type MarkNotificationReadBody = z.infer<typeof markNotificationReadSchema>;
