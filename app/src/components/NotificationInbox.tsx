import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NotificationType } from '@sporthub/shared';
import {
  markAllNotificationsReadApi,
  markNotificationReadApi,
  notificationsKeys,
  useNotifications,
  useUnreadNotificationsCount,
  type NotificationItemDto,
} from '../api/notifications.ts';
import { checkPublicPromotionApi } from '../api/promotions.ts';
import { queryClient } from '../api/queryClient.ts';
import { useAuth } from '../auth/authContext.ts';
import { useToast } from '../ui/toastContext.ts';
import { extractErrorMessage, formatDateTimeVn } from '../utils/format.ts';

const TYPES: [NotificationType | 'all', string][] = [
  ['all', 'Tất cả loại'],
  ['REMINDER', 'Nhắc lịch'],
  ['PROMOTION', 'Ưu đãi'],
  ['PAYMENT_RESULT', 'Thanh toán'],
  ['SCHEDULE_CHANGE', 'Thay đổi lịch'],
];

/** Trung tâm Thông báo động (API-05, 21, 22, 23, 24). */
export default function NotificationInbox({
  onSelectBooking,
}: {
  onSelectBooking?: (bookingCode: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [type, setType] = useState<NotificationType | 'all'>('all');
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');

  const queryParams = {
    ...(type !== 'all' ? { type } : {}),
    ...(readFilter === 'all' ? {} : { isRead: readFilter === 'read' }),
    page: 1,
    pageSize: 30,
  };

  const listQ = useNotifications(queryParams, { enabled: user !== null });
  const unreadQ = useUnreadNotificationsCount({ enabled: user !== null });
  const unreadCount = unreadQ.data?.unreadCount ?? listQ.data?.meta.unreadCount ?? 0;
  const list = listQ.data?.data ?? [];

  const handleMarkRead = async (n: NotificationItemDto) => {
    if (n.isRead) return;
    try {
      await markNotificationReadApi(n.notificationId);
      await queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsReadApi();
      await queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      toast('Đã đánh dấu tất cả thông báo là đã đọc.', 'ok');
    } catch (err) {
      toast(extractErrorMessage(err), 'err');
    }
  };

  const handleApplyPromo = async (code: string, n: NotificationItemDto) => {
    await handleMarkRead(n);
    try {
      const check = await checkPublicPromotionApi(code);
      if (!check.usable) {
        toast(check.message ?? 'Chương trình ưu đãi không còn hiệu lực.', 'err');
        return;
      }
      nav(`/booking?promo=${encodeURIComponent(code)}`);
    } catch (err) {
      toast(extractErrorMessage(err, 'Chương trình ưu đãi đã kết thúc.'), 'err');
    }
  };

  const handleOpenBooking = async (bookingCode: string, n: NotificationItemDto) => {
    await handleMarkRead(n);
    if (onSelectBooking) {
      onSelectBooking(bookingCode);
      return;
    }
    nav(`/payment/${encodeURIComponent(bookingCode)}`);
  };

  return (
    <aside
      className="span4 card col g16"
      style={{ boxShadow: 'var(--shadow-sm)', alignSelf: 'flex-start' }}
    >
      <div className="row between wrap g8 head-rule">
        <div className="row g8">
          <i
            style={{
              width: 10,
              height: 10,
              borderRadius: 9999,
              background: 'var(--brand-700)',
              flex: 'none',
            }}
          />
          <h2 className="t16 w800 c-ink" style={{ lineHeight: '24px' }}>
            Thông báo nhắc lịch & Ưu đãi
          </h2>
        </div>
        <span
          className="badge c-white"
          style={{
            background: unreadCount ? 'var(--brand-700)' : 'var(--s500)',
            padding: '2px 10px',
          }}
        >
          {unreadCount} mới
        </span>
      </div>
      <div className="row g8">
        <select
          data-testid="notif-filter-type"
          className="select sm f1"
          value={type}
          onChange={(e) => setType(e.target.value as NotificationType | 'all')}
        >
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          data-testid="notif-filter-read"
          className="select sm f1"
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value as 'all' | 'unread' | 'read')}
        >
          <option value="all">Tất cả</option>
          <option value="unread">Chưa đọc</option>
          <option value="read">Đã đọc</option>
        </select>
      </div>
      {unreadCount > 0 && (
        <button
          type="button"
          className="link-btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void handleMarkAll()}
        >
          Đánh dấu tất cả đã đọc
        </button>
      )}
      {listQ.isLoading && (
        <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
          Đang tải thông báo...
        </div>
      )}
      {!listQ.isLoading && list.length === 0 && (
        <div className="hint" style={{ textAlign: 'center', padding: 20 }}>
          Không có thông báo nào phù hợp.
        </div>
      )}
      {list.map((n) => (
        <div
          key={n.notificationId}
          data-testid={`notif-${n.notificationId}`}
          className="col g6"
          style={{
            background: !n.isRead ? 'var(--brand-50)' : 'var(--s100)',
            border: !n.isRead ? '2px solid var(--brand-600)' : '1px solid var(--s300)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div className="row between wrap g6" style={{ alignItems: 'flex-start' }}>
            <b className="t12 c-ink break-word">{n.title}</b>
            <b className="t10 c-s500 nowrap" style={{ fontWeight: 600 }}>
              {formatDateTimeVn(n.createdAt)}
            </b>
          </div>
          <p className="t12 c-s700" style={{ lineHeight: '19.5px' }}>
            {n.body}
          </p>
          <div className="row g12 wrap">
            {n.promotionCode && (
              <button
                type="button"
                className="link-btn"
                onClick={() => void handleApplyPromo(n.promotionCode!, n)}
              >
                Dùng mã {n.promotionCode} →
              </button>
            )}
            {n.bookingCode && (
              <button
                type="button"
                className="link-btn"
                onClick={() => void handleOpenBooking(n.bookingCode!, n)}
              >
                Xem đơn #{n.bookingCode} →
              </button>
            )}
            {!n.isRead && (
              <button
                type="button"
                className="link-btn"
                style={{ color: 'var(--s600)' }}
                onClick={() => void handleMarkRead(n)}
              >
                Đánh dấu đã đọc
              </button>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
