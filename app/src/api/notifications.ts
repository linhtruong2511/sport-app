import { useQuery } from '@tanstack/react-query';
import type {
  ApiListSuccess,
  ApiSuccess,
  NotificationLinkType,
  NotificationType,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface NotificationItemDto {
  notificationId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkType: NotificationLinkType | null;
  bookingCode: string | null;
  promotionCode: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface GetNotificationsParams {
  type?: NotificationType;
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}

export type NotificationsListResponse = ApiListSuccess<NotificationItemDto> & {
  meta: {
    unreadCount: number;
  };
};

export interface UnreadCountResponse {
  unreadCount: number;
}

export interface MarkNotificationReadResponse {
  notificationId: number;
  isRead: boolean;
  readAt: string | null;
  unreadCount: number;
}

export interface ReadAllNotificationsResponse {
  updated: number;
  unreadCount: number;
}

export const notificationsKeys = {
  all: ['notifications'] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
  list: (params?: GetNotificationsParams) => ['notifications', 'list', params ?? {}] as const,
};

export async function getUnreadCountApi(): Promise<UnreadCountResponse> {
  const res = await apiFetch<ApiSuccess<UnreadCountResponse>>('/me/notifications/unread-count');
  return res.data;
}

export async function getNotificationsApi(
  params?: GetNotificationsParams,
): Promise<NotificationsListResponse> {
  const search = new URLSearchParams();
  if (params?.type) {
    search.set('type', params.type);
  }
  if (typeof params?.isRead === 'boolean') {
    search.set('isRead', String(params.isRead));
  }
  if (typeof params?.page === 'number') {
    search.set('page', String(params.page));
  }
  if (typeof params?.pageSize === 'number') {
    search.set('pageSize', String(params.pageSize));
  }
  const qs = search.toString();
  return apiFetch<NotificationsListResponse>(
    qs ? `/me/notifications?${qs}` : '/me/notifications',
  );
}

export async function markNotificationReadApi(
  notificationId: number,
): Promise<MarkNotificationReadResponse> {
  const res = await apiFetch<ApiSuccess<MarkNotificationReadResponse>>(
    `/me/notifications/${notificationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isRead: true }),
    },
  );
  return res.data;
}

export async function markAllNotificationsReadApi(): Promise<ReadAllNotificationsResponse> {
  const res = await apiFetch<ApiSuccess<ReadAllNotificationsResponse>>(
    '/me/notifications/read-all',
    {
      method: 'POST',
    },
  );
  return res.data;
}

export function useUnreadNotificationsCount(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: () => getUnreadCountApi(),
    enabled: options?.enabled ?? true,
  });
}

export function useNotifications(
  params?: GetNotificationsParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: notificationsKeys.list(params),
    queryFn: () => getNotificationsApi(params),
    enabled: options?.enabled ?? true,
  });
}
