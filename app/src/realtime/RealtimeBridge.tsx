import { useEffect } from 'react';
import { affectedKeys } from '../api/affected.ts';
import { availabilityKeys } from '../api/availability.ts';
import { bookingsKeys } from '../api/bookings.ts';
import { catalogKeys } from '../api/catalog.ts';
import { dashboardKeys } from '../api/dashboard.ts';
import { notificationsKeys } from '../api/notifications.ts';
import { paymentsKeys } from '../api/payments.ts';
import { posKeys } from '../api/pos.ts';
import { queryClient } from '../api/queryClient.ts';
import { reconciliationKeys } from '../api/reconciliation.ts';
import { getSocket } from '../api/socket.ts';
import { useAuth } from '../auth/authContext.ts';
import { useToast } from '../ui/toastContext.ts';

interface NotificationCreatedPayload {
  title?: string;
}

interface BookingEventPayload {
  bookingCode?: string;
}

export function RealtimeBridge() {
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    const socket = getSocket();

    const onNotificationCreated = (payload?: NotificationCreatedPayload) => {
      void queryClient.invalidateQueries({ queryKey: notificationsKeys.all });
      if (payload?.title && user) {
        toast(payload.title, 'info');
      }
    };

    const onSlotUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: affectedKeys.all });
    };

    const onBookingChanged = (payload?: BookingEventPayload) => {
      if (payload?.bookingCode) {
        void queryClient.invalidateQueries({
          queryKey: bookingsKeys.detail(payload.bookingCode),
        });
        void queryClient.invalidateQueries({
          queryKey: paymentsKeys.request(payload.bookingCode),
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: paymentsKeys.all });
      }
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.all });
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void queryClient.invalidateQueries({ queryKey: affectedKeys.all });
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
    };

    const onPaymentRequestExpired = (payload?: BookingEventPayload) => {
      if (payload?.bookingCode) {
        void queryClient.invalidateQueries({
          queryKey: paymentsKeys.request(payload.bookingCode),
        });
        void queryClient.invalidateQueries({
          queryKey: bookingsKeys.detail(payload.bookingCode),
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: paymentsKeys.all });
      }
      void queryClient.invalidateQueries({ queryKey: bookingsKeys.all });
    };

    const onReconciliationCreated = () => {
      void queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
    };

    socket.on('notification.created', onNotificationCreated);
    socket.on('slot.updated', onSlotUpdated);
    socket.on('booking.updated', onBookingChanged);
    socket.on('booking.paid', onBookingChanged);
    socket.on('payment_request.expired', onPaymentRequestExpired);
    socket.on('reconciliation.created', onReconciliationCreated);

    return () => {
      socket.off('notification.created', onNotificationCreated);
      socket.off('slot.updated', onSlotUpdated);
      socket.off('booking.updated', onBookingChanged);
      socket.off('booking.paid', onBookingChanged);
      socket.off('payment_request.expired', onPaymentRequestExpired);
      socket.off('reconciliation.created', onReconciliationCreated);
    };
  }, [user, toast]);

  return null;
}
