import type { AddressInfo } from 'node:net';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BookingStateModule } from '../../bookings/booking-state.module.js';
import { closePool, sql } from '../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../auth/index.js';
import { CoreModule } from '../core.module.js';
import { DbTransactionService } from '../db/transaction.js';
import { AppError } from '../errors.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { addDays, addMinutes, formatDateVn, parseVnDateTime, toSqlDateTime } from '../time.js';
import { DatabaseModule } from '../../database/database.module.js';

let seededUsers: Record<string, AuthenticatedUser> = {};

const mockTokenVerifier: TokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = seededUsers[token];
    if (!user) {
      throw new AppError('UNAUTHENTICATED');
    }
    return user;
  },
};

@Global()
@Module({
  providers: [{ provide: TOKEN_VERIFIER, useValue: mockTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
class TestAuthModule {}

@Module({
  imports: [CoreModule, DatabaseModule, TestAuthModule, BookingStateModule],
})
class RealtimeTestAppModule {}

function connectSocket(url: string, token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(url, {
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      forceNew: true,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });
}

describe('core/realtime Socket.IO authorization integration (C-1)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let realtimeService: RealtimeService;
  let baseUrl: string;
  let cs01BookingCode: string;
  const openSockets: ClientSocket[] = [];
  const createdBookingIds: number[] = [];

  beforeAll(async () => {
    app = await NestFactory.create(RealtimeTestAppModule, new ExpressAdapter(), { logger: false });
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    txService = app.get(DbTransactionService);
    realtimeService = app.get(RealtimeService);

    const exec = await txService.executor();
    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
      Role: 'OWNER' | 'STAFF' | 'CUSTOMER';
      BranchId: number | null;
      TokenVersion: number;
    }>(`
      SELECT Phone, UserId, Role, BranchId, TokenVersion
      FROM dbo.Users
      WHERE Phone IN ('0987654321', '0912345678', '0933445577', '0933445566', '0900000001')
    `);
    const uMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));

    const an = uMap.get('0987654321')!;
    const binh = uMap.get('0912345678')!;
    const staffCs01 = uMap.get('0933445577')!;
    const staffCs02 = uMap.get('0933445566')!;
    const owner = uMap.get('0900000001')!;

    seededUsers = {
      'token-an': { userId: Number(an.UserId), role: 'CUSTOMER', branchId: null, tv: Number(an.TokenVersion) },
      'token-binh': { userId: Number(binh.UserId), role: 'CUSTOMER', branchId: null, tv: Number(binh.TokenVersion) },
      'token-staff-cs01': {
        userId: Number(staffCs01.UserId),
        role: 'STAFF',
        branchId: Number(staffCs01.BranchId),
        tv: Number(staffCs01.TokenVersion),
      },
      'token-staff-cs02': {
        userId: Number(staffCs02.UserId),
        role: 'STAFF',
        branchId: Number(staffCs02.BranchId),
        tv: Number(staffCs02.TokenVersion),
      },
      'token-owner': { userId: Number(owner.UserId), role: 'OWNER', branchId: null, tv: Number(owner.TokenVersion) },
    };

    const courtRes = await exec.request().query<{ CourtId: number; BranchId: number }>(`
      SELECT TOP 1 CourtId, BranchId FROM dbo.Courts WHERE Code = 'SAN_PB_01'
    `);
    const court = courtRes.recordset[0];
    const playDate = formatDateVn(addDays(new Date(), 20));
    const startAt = parseVnDateTime(playDate, '09:00');
    const endAt = parseVnDateTime(playDate, '10:00');
    const holdExpireAt = addMinutes(new Date(), 10);

    cs01BookingCode = `BK${playDate.replace(/-/g, '')}991`;
    const ins = await exec
      .request()
      .input('code', sql.VarChar(20), cs01BookingCode)
      .input('branchId', sql.Int, Number(court.BranchId))
      .input('courtId', sql.Int, Number(court.CourtId))
      .input('custId', sql.BigInt, Number(an.UserId))
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .input('holdExpireAt', sql.DateTime2(0), toSqlDateTime(holdExpireAt))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption,
          DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt, CreatedBy, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @custId, @startAt, @endAt,
          200000, 0, 200000, 'FULL',
          0, 200000, 0, 200000,
          'PENDING_PAYMENT', 'UNPAID', @holdExpireAt, @custId, 'ONLINE'
        )
      `);
    createdBookingIds.push(Number(ins.recordset[0].BookingId));
  });

  afterEach(() => {
    for (const s of openSockets) {
      s.disconnect();
    }
    openSockets.length = 0;
  });

  afterAll(async () => {
    if (createdBookingIds.length > 0 && txService) {
      const exec = await txService.executor();
      await exec.request().query(
        `DELETE FROM dbo.Bookings WHERE BookingId IN (${createdBookingIds.join(',')})`,
      );
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('blocks unauthorized customer and other-branch staff from joining booking room, while allowing owner/owner-customer/branch-staff', async () => {
    const anSocket = await connectSocket(baseUrl, 'token-an');
    const binhSocket = await connectSocket(baseUrl, 'token-binh');
    const cs02Socket = await connectSocket(baseUrl, 'token-staff-cs02');
    const cs01Socket = await connectSocket(baseUrl, 'token-staff-cs01');
    openSockets.push(anSocket, binhSocket, cs02Socket, cs01Socket);

    const anEvents: unknown[] = [];
    const binhEvents: unknown[] = [];
    const cs02Events: unknown[] = [];
    const cs01Events: unknown[] = [];
    const binhSubErrors: unknown[] = [];
    const cs02SubErrors: unknown[] = [];

    anSocket.on('booking.paid', (p) => anEvents.push(p));
    binhSocket.on('booking.paid', (p) => binhEvents.push(p));
    cs02Socket.on('booking.paid', (p) => cs02Events.push(p));
    cs01Socket.on('booking.paid', (p) => cs01Events.push(p));
    binhSocket.on('subscribe_error', (p) => binhSubErrors.push(p));
    cs02Socket.on('subscribe_error', (p) => cs02SubErrors.push(p));

    anSocket.emit('subscribe', { channel: 'booking', bookingCode: cs01BookingCode });
    binhSocket.emit('subscribe', { channel: 'booking', bookingCode: cs01BookingCode });
    cs02Socket.emit('subscribe', { channel: 'booking', bookingCode: cs01BookingCode });
    cs01Socket.emit('subscribe', { channel: 'booking', bookingCode: cs01BookingCode });

    await new Promise((r) => setTimeout(r, 250));

    realtimeService.flush([
      {
        rooms: [`booking:${cs01BookingCode}`],
        event: 'booking.paid',
        payload: {
          bookingCode: cs01BookingCode,
          amount: 200_000,
        },
      },
    ]);

    await new Promise((r) => setTimeout(r, 200));

    expect(anEvents).toHaveLength(1);
    expect(cs01Events).toHaveLength(1);
    expect(binhEvents).toHaveLength(0);
    expect(cs02Events).toHaveLength(0);
    expect(binhSubErrors).toHaveLength(1);
    expect(cs02SubErrors).toHaveLength(1);
  });
});
