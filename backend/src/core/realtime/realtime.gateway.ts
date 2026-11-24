import { Inject, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { ERROR_CATALOG } from '@sporthub/shared/errors';
import type { Server, Socket } from 'socket.io';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../auth/auth.types.js';
import { AppError } from '../errors.js';
import { RealtimeService } from './realtime.service.js';

interface SubscribePayload {
  channel?: string;
  branchId?: number;
  date?: string;
  bookingCode?: string;
}

@WebSocketGateway({ namespace: '/', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtimeService: RealtimeService,
    @Optional() @Inject(TOKEN_VERIFIER) private readonly tokenVerifier?: TokenVerifier,
  ) {}

  afterInit(server: Server): void {
    this.realtimeService.attachServer(server);
  }

  // SDD 5.7: Xác thực JWT khi bắt tay; khách chưa đăng nhập vẫn kết nối được nhưng chỉ vào phòng availability
  async handleConnection(client: Socket): Promise<void> {
    const rawToken = client.handshake.auth?.token;
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';

    if (!token) {
      client.data.user = undefined;
      return;
    }

    if (!this.tokenVerifier) {
      client.emit('auth_error', {
        code: 'INTERNAL_ERROR',
        message: ERROR_CATALOG.INTERNAL_ERROR.defaultMessage,
      });
      client.disconnect(true);
      return;
    }

    try {
      const user = await this.tokenVerifier.verifyAccessToken(token);
      client.data.user = user;
      await client.join(`user:${user.userId}`);
      if (user.role === 'STAFF' && user.branchId !== null) {
        await client.join(`branch:${user.branchId}`);
      }
    } catch (err) {
      if (err instanceof AppError) {
        client.emit('auth_error', { code: err.code, message: err.message });
      } else {
        client.emit('auth_error', {
          code: 'UNAUTHENTICATED',
          message: ERROR_CATALOG.UNAUTHENTICATED.defaultMessage,
        });
      }
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribePayload,
  ): void {
    if (!payload) {
      return;
    }

    if (
      payload.channel === 'availability' &&
      typeof payload.branchId === 'number' &&
      Number.isInteger(payload.branchId) &&
      payload.branchId > 0 &&
      typeof payload.date === 'string' &&
      payload.date.length > 0
    ) {
      void client.join(`availability:${payload.branchId}:${payload.date}`);
      return;
    }

    const user = client.data?.user as AuthenticatedUser | undefined;
    if (!user) {
      return;
    }

    if (
      payload.channel === 'branch' &&
      typeof payload.branchId === 'number' &&
      Number.isInteger(payload.branchId) &&
      payload.branchId > 0
    ) {
      if (user.role === 'OWNER' || (user.role === 'STAFF' && user.branchId === payload.branchId)) {
        void client.join(`branch:${payload.branchId}`);
      }
      return;
    }

    if (
      payload.channel === 'booking' &&
      typeof payload.bookingCode === 'string' &&
      payload.bookingCode.trim().length > 0
    ) {
      // Fine-grained booking ownership / branch check will be added in M3
      void client.join(`booking:${payload.bookingCode.trim()}`);
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribePayload,
  ): void {
    if (!payload) {
      return;
    }

    if (
      payload.channel === 'availability' &&
      typeof payload.branchId === 'number' &&
      typeof payload.date === 'string' &&
      payload.date.length > 0
    ) {
      void client.leave(`availability:${payload.branchId}:${payload.date}`);
      return;
    }

    if (payload.channel === 'branch' && typeof payload.branchId === 'number') {
      void client.leave(`branch:${payload.branchId}`);
      return;
    }

    if (
      payload.channel === 'booking' &&
      typeof payload.bookingCode === 'string' &&
      payload.bookingCode.trim().length > 0
    ) {
      void client.leave(`booking:${payload.bookingCode.trim()}`);
    }
  }
}
