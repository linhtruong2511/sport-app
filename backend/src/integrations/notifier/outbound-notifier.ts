import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@sporthub/shared/enums';
import { AppLogger } from '../../core/logger.js';

export interface OutboundNotificationPayload {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  bookingCode?: string | null;
  promotionCode?: string | null;
}

export interface OutboundNotifier {
  send(payload: OutboundNotificationPayload): Promise<void>;
}

export const OUTBOUND_NOTIFIER = Symbol('OUTBOUND_NOTIFIER');

/**
 * Q-08: Outbound Email/SMS/Zalo adapter stub — logs intent without external delivery.
 */
@Injectable()
export class StubOutboundNotifier implements OutboundNotifier {
  constructor(private readonly logger: AppLogger) {}

  async send(payload: OutboundNotificationPayload): Promise<void> {
    this.logger.info('Outbound notification stub dispatched', {
      context: 'StubOutboundNotifier',
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      bookingCode: payload.bookingCode ?? null,
      promotionCode: payload.promotionCode ?? null,
    });
  }
}
