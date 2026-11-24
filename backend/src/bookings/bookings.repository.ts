import { Injectable } from '@nestjs/common';
import type {
  BookingChannel,
  BookingStatus,
  CancelType,
  DepositType,
  PaymentMethod,
  PaymentOption,
  PaymentPurpose,
  PaymentStatus,
} from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import { mapSqlError } from '../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { toSqlDate, toSqlDateTime } from '../core/time.js';
import type {
  BookingPaymentRow,
  BookingPriceLineRow,
  BookingRefundRow,
  BookingRow,
  BookingStatusHistoryRow,
  BookingTransferRow,
} from './bookings.mapper.js';

const BOOKING_SELECT = `
  b.BookingId,
  b.BookingCode,
  b.BranchId,
  br.Name AS BranchName,
  br.Address AS BranchAddress,
  b.CourtId,
  c.Code AS CourtCode,
  c.Name AS CourtName,
  sp.Code AS SportCode,
  sp.Name AS SportName,
  b.CustomerUserId,
  cu.FullName AS CustomerUserName,
  cu.Phone AS CustomerUserPhone,
  b.GuestName,
  b.GuestPhone,
  b.StartAt,
  b.EndAt,
  b.BaseAmount,
  b.DiscountAmount,
  b.TotalAmount,
  b.PaymentOption,
  b.DepositType,
  b.DepositValue,
  b.DepositAmount,
  b.AmountDueNow,
  b.PaidAmount,
  b.RemainingAmount,
  b.Status,
  b.PaymentStatus,
  b.HoldExpireAt,
  b.PromotionCode,
  b.CanceledBy,
  cb.FullName AS CanceledByName,
  b.CanceledAt,
  b.CancelReason,
  b.CancelType,
  b.RefundRate,
  b.RefundAmount,
  b.ReminderSentAt,
  b.Note,
  b.CreatedBy,
  b.CreatedAt,
  b.UpdatedAt,
  b.RowVer,
  b.CheckedInAt,
  b.CheckedOutAt,
  b.Channel
`;

const BOOKING_FROM = `
  FROM dbo.Bookings b
  INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
  INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
  INNER JOIN dbo.Sports sp ON sp.SportId = c.SportId
  LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
  LEFT JOIN dbo.Users cb ON cb.UserId = b.CanceledBy
`;

export interface InsertBookingInput {
  bookingCode: string;
  branchId: number;
  courtId: number;
  customerUserId: number | null;
  guestName: string | null;
  guestPhone: string | null;
  startAt: Date;
  endAt: Date;
  baseAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentOption: PaymentOption;
  depositType: DepositType | null;
  depositValue: number | null;
  depositAmount: number;
  amountDueNow: number;
  paidAmount: number;
  remainingAmount: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  holdExpireAt: Date | null;
  promotionCode: string | null;
  note: string | null;
  createdBy: number | null;
  now: Date;
  channel: BookingChannel;
}

export interface InsertBookingPriceLineInput {
  bookingId: number;
  priceRuleId: number;
  startAt: Date;
  endAt: Date;
  pricePerHour: number;
  amount: number;
}

export interface InsertStatusHistoryInput {
  bookingId: number;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  fromPaymentStatus: PaymentStatus | null;
  toPaymentStatus: PaymentStatus | null;
  changedBy: number | null;
  changedAt: Date;
  note: string | null;
}

export interface InsertPaymentRecordInput {
  paymentCode: string;
  bookingId: number;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  channel: BookingChannel;
  amount: number;
  requestId: number | null;
  bankTxnId: number | null;
  collectedBy: number | null;
  paidAt: Date;
}

@Injectable()
export class BookingsRepository {
  async findByCode(exec: DbExecutor, bookingCode: string): Promise<BookingRow | null> {
    const res = await exec
      .request()
      .input('code', sql.VarChar(20), bookingCode)
      .query<BookingRow>(`
        SELECT ${BOOKING_SELECT}
        ${BOOKING_FROM}
        WHERE b.BookingCode = @code
      `);

    return res.recordset[0] ?? null;
  }

  async findByCodeForUpdate(tx: TxContext, bookingCode: string): Promise<BookingRow | null> {
    const res = await tx
      .request()
      .input('code', sql.VarChar(20), bookingCode)
      .query<BookingRow>(`
        SELECT ${BOOKING_SELECT}
        FROM dbo.Bookings b WITH (UPDLOCK, ROWLOCK)
        INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
        INNER JOIN dbo.Courts c ON c.CourtId = b.CourtId
        INNER JOIN dbo.Sports sp ON sp.SportId = c.SportId
        LEFT JOIN dbo.Users cu ON cu.UserId = b.CustomerUserId
        LEFT JOIN dbo.Users cb ON cb.UserId = b.CanceledBy
        WHERE b.BookingCode = @code
      `);

    return res.recordset[0] ?? null;
  }

  async findDetailRelations(exec: DbExecutor, bookingId: number) {
    const [priceLinesRes, paymentsRes, historyRes, transfersRes, refundRes] = await Promise.all([
      exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .query<BookingPriceLineRow>(`
          SELECT r.Label, pl.StartAt, pl.EndAt, pl.PricePerHour, pl.Amount
          FROM dbo.BookingPriceLines pl
          INNER JOIN dbo.CourtPriceRules r ON r.PriceRuleId = pl.PriceRuleId
          WHERE pl.BookingId = @bookingId
          ORDER BY pl.StartAt ASC
        `),
      exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .query<BookingPaymentRow>(`
          SELECT p.PaymentCode, p.Purpose, p.Method, p.Channel, p.Amount, p.PaidAt,
                 u.FullName AS CollectedByName
          FROM dbo.Payments p
          LEFT JOIN dbo.Users u ON u.UserId = p.CollectedBy
          WHERE p.BookingId = @bookingId
          ORDER BY p.PaidAt ASC, p.PaymentId ASC
        `),
      exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .query<BookingStatusHistoryRow>(`
          SELECT h.FromStatus, h.ToStatus, h.FromPaymentStatus, h.ToPaymentStatus,
                 h.ChangedAt, u.FullName AS ChangedByName, h.Note
          FROM dbo.BookingStatusHistory h
          LEFT JOIN dbo.Users u ON u.UserId = h.ChangedBy
          WHERE h.BookingId = @bookingId
          ORDER BY h.ChangedAt ASC, h.HistoryId ASC
        `),
      exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .query<BookingTransferRow>(`
          SELECT oc.Name AS OldCourtName, t.OldStartAt,
                 nc.Name AS NewCourtName, t.NewStartAt,
                 u.FullName AS PerformedByName, t.PerformedAt, t.Note
          FROM dbo.BookingTransfers t
          INNER JOIN dbo.Courts oc ON oc.CourtId = t.OldCourtId
          INNER JOIN dbo.Courts nc ON nc.CourtId = t.NewCourtId
          INNER JOIN dbo.Users u ON u.UserId = t.PerformedBy
          WHERE t.BookingId = @bookingId
          ORDER BY t.PerformedAt ASC
        `),
      exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .query<BookingRefundRow>(`
          SELECT TOP 1 RefundId, Amount, Rate, Status
          FROM dbo.Refunds
          WHERE BookingId = @bookingId
          ORDER BY RefundId DESC
        `),
    ]);

    return {
      priceLines: priceLinesRes.recordset,
      payments: paymentsRes.recordset,
      statusHistory: historyRes.recordset,
      transfers: transfersRes.recordset,
      refund: refundRes.recordset[0] ?? null,
    };
  }

  async listCustomerBookings(
    exec: DbExecutor,
    params: {
      customerUserId: number;
      from: string;
      to: string;
      status: 'ALL' | BookingStatus;
      page: number;
      pageSize: number;
    },
  ): Promise<{
    rows: BookingRow[];
    totalItems: number;
    statusCounts: Record<'ALL' | BookingStatus, number>;
  }> {
    const countsRes = await exec
      .request()
      .input('userId', sql.BigInt, params.customerUserId)
      .input('from', sql.Date, toSqlDate(params.from))
      .input('to', sql.Date, toSqlDate(params.to))
      .query<{ Status: BookingStatus; Cnt: number }>(`
        SELECT Status, COUNT(*) AS Cnt
        FROM dbo.Bookings
        WHERE CustomerUserId = @userId
          AND CAST(StartAt AS DATE) >= @from
          AND CAST(StartAt AS DATE) <= @to
        GROUP BY Status
      `);

    const statusCounts: Record<'ALL' | BookingStatus, number> = {
      ALL: 0,
      PENDING_PAYMENT: 0,
      CONFIRMED: 0,
      IN_USE: 0,
      COMPLETED: 0,
      EXPIRED: 0,
      CANCELED: 0,
    };
    for (const r of countsRes.recordset) {
      const cnt = Number(r.Cnt);
      statusCounts[r.Status] = cnt;
      statusCounts.ALL += cnt;
    }

    const totalItems =
      params.status === 'ALL' ? statusCounts.ALL : statusCounts[params.status];

    const offset = (params.page - 1) * params.pageSize;
    const statusFilterSql = params.status === 'ALL' ? '' : 'AND b.Status = @status';

    const rowsRes = await exec
      .request()
      .input('userId', sql.BigInt, params.customerUserId)
      .input('from', sql.Date, toSqlDate(params.from))
      .input('to', sql.Date, toSqlDate(params.to))
      .input('status', sql.VarChar(20), params.status)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, params.pageSize)
      .query<BookingRow>(`
        SELECT ${BOOKING_SELECT}
        ${BOOKING_FROM}
        WHERE b.CustomerUserId = @userId
          AND CAST(b.StartAt AS DATE) >= @from
          AND CAST(b.StartAt AS DATE) <= @to
          ${statusFilterSql}
        ORDER BY
          CASE
            WHEN b.Status IN ('CONFIRMED', 'IN_USE') THEN 1
            WHEN b.Status = 'PENDING_PAYMENT' THEN 2
            WHEN b.Status = 'COMPLETED' THEN 3
            ELSE 4
          END ASC,
          b.StartAt ASC,
          b.BookingId DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

    return {
      rows: rowsRes.recordset,
      totalItems,
      statusCounts,
    };
  }

  async insertBooking(tx: TxContext, input: InsertBookingInput): Promise<number> {
    const res = await tx
      .request()
      .input('bookingCode', sql.VarChar(20), input.bookingCode)
      .input('branchId', sql.Int, input.branchId)
      .input('courtId', sql.Int, input.courtId)
      .input('customerUserId', sql.BigInt, input.customerUserId)
      .input('guestName', sql.NVarChar(100), input.guestName)
      .input('guestPhone', sql.VarChar(10), input.guestPhone)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(input.startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(input.endAt))
      .input('baseAmount', sql.Decimal(18, 0), input.baseAmount)
      .input('discountAmount', sql.Decimal(18, 0), input.discountAmount)
      .input('totalAmount', sql.Decimal(18, 0), input.totalAmount)
      .input('paymentOption', sql.VarChar(10), input.paymentOption)
      .input('depositType', sql.VarChar(10), input.depositType)
      .input('depositValue', sql.Decimal(18, 2), input.depositValue)
      .input('depositAmount', sql.Decimal(18, 0), input.depositAmount)
      .input('amountDueNow', sql.Decimal(18, 0), input.amountDueNow)
      .input('paidAmount', sql.Decimal(18, 0), input.paidAmount)
      .input('remainingAmount', sql.Decimal(18, 0), input.remainingAmount)
      .input('status', sql.VarChar(20), input.status)
      .input('paymentStatus', sql.VarChar(20), input.paymentStatus)
      .input('holdExpireAt', sql.DateTime2(0), input.holdExpireAt ? toSqlDateTime(input.holdExpireAt) : null)
      .input('promotionCode', sql.VarChar(20), input.promotionCode)
      .input('note', sql.NVarChar(500), input.note)
      .input('createdBy', sql.BigInt, input.createdBy)
      .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
      .input('channel', sql.VarChar(20), input.channel)
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone,
          StartAt, EndAt, BaseAmount, DiscountAmount, TotalAmount,
          PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt, PromotionCode, Note,
          CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @bookingCode, @branchId, @courtId, @customerUserId, @guestName, @guestPhone,
          @startAt, @endAt, @baseAmount, @discountAmount, @totalAmount,
          @paymentOption, @depositType, @depositValue, @depositAmount,
          @amountDueNow, @paidAmount, @remainingAmount,
          @status, @paymentStatus, @holdExpireAt, @promotionCode, @note,
          @createdBy, @now, @now, @channel
        )
      `);

    return Number(res.recordset[0].BookingId);
  }

  async insertBookingSlots(
    tx: TxContext,
    bookingId: number,
    courtId: number,
    slotStarts: Date[],
  ): Promise<void> {
    try {
      for (const slotStart of slotStarts) {
        await tx
          .request()
          .input('bookingId', sql.BigInt, bookingId)
          .input('courtId', sql.Int, courtId)
          .input('slotStart', sql.DateTime2(0), toSqlDateTime(slotStart))
          .query(`
            INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
            VALUES (@bookingId, @courtId, @slotStart, 1)
          `);
      }
    } catch (err) {
      mapSqlError(err);
    }
  }

  async insertBookingPriceLines(
    tx: TxContext,
    lines: InsertBookingPriceLineInput[],
  ): Promise<void> {
    for (const line of lines) {
      await tx
        .request()
        .input('bookingId', sql.BigInt, line.bookingId)
        .input('priceRuleId', sql.BigInt, line.priceRuleId)
        .input('startAt', sql.DateTime2(0), toSqlDateTime(line.startAt))
        .input('endAt', sql.DateTime2(0), toSqlDateTime(line.endAt))
        .input('pricePerHour', sql.Decimal(18, 0), line.pricePerHour)
        .input('amount', sql.Decimal(18, 0), line.amount)
        .query(`
          INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount)
          VALUES (@bookingId, @priceRuleId, @startAt, @endAt, @pricePerHour, @amount)
        `);
    }
  }

  async insertStatusHistory(tx: TxContext, input: InsertStatusHistoryInput): Promise<void> {
    await tx
      .request()
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('fromStatus', sql.VarChar(20), input.fromStatus)
      .input('toStatus', sql.VarChar(20), input.toStatus)
      .input('fromPay', sql.VarChar(20), input.fromPaymentStatus)
      .input('toPay', sql.VarChar(20), input.toPaymentStatus)
      .input('changedBy', sql.BigInt, input.changedBy)
      .input('changedAt', sql.DateTime2(0), toSqlDateTime(input.changedAt))
      .input('note', sql.NVarChar(500), input.note)
      .query(`
        INSERT INTO dbo.BookingStatusHistory (
          BookingId, FromStatus, ToStatus, FromPaymentStatus, ToPaymentStatus,
          ChangedBy, ChangedAt, Note
        )
        VALUES (
          @bookingId, @fromStatus, @toStatus, @fromPay, @toPay,
          @changedBy, @changedAt, @note
        )
      `);
  }

  async deactivateBookingSlots(tx: TxContext, bookingId: number): Promise<void> {
    await tx
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        UPDATE dbo.BookingSlots
        SET IsActive = 0
        WHERE BookingId = @bookingId AND IsActive = 1
      `);
  }

  async incrementPromotionUsedCount(tx: TxContext, promotionId: number, now: Date): Promise<boolean> {
    const res = await tx
      .request()
      .input('promotionId', sql.Int, promotionId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Promotions
        SET UsedCount = UsedCount + 1,
            UpdatedAt = @now
        WHERE PromotionId = @promotionId
          AND Status = 'ACTIVE'
          AND UsedCount < MaxUses
      `);

    return (res.rowsAffected[0] ?? 0) > 0;
  }

  async decrementPromotionUsedCount(tx: TxContext, code: string, now: Date): Promise<void> {
    await tx
      .request()
      .input('code', sql.VarChar(20), code)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Promotions
        SET UsedCount = UsedCount - 1,
            UpdatedAt = @now
        WHERE Code = @code
          AND UsedCount > 0
      `);
  }

  async insertPaymentRecord(tx: TxContext, input: InsertPaymentRecordInput): Promise<number> {
    const res = await tx
      .request()
      .input('paymentCode', sql.VarChar(20), input.paymentCode)
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('purpose', sql.VarChar(20), input.purpose)
      .input('method', sql.VarChar(20), input.method)
      .input('channel', sql.VarChar(20), input.channel)
      .input('amount', sql.Decimal(18, 0), input.amount)
      .input('requestId', sql.BigInt, input.requestId)
      .input('bankTxnId', sql.BigInt, input.bankTxnId)
      .input('collectedBy', sql.BigInt, input.collectedBy)
      .input('paidAt', sql.DateTime2(0), toSqlDateTime(input.paidAt))
      .query<{ PaymentId: number | string }>(`
        INSERT INTO dbo.Payments (
          PaymentCode, BookingId, Purpose, Method, Channel, Amount,
          RequestId, BankTxnId, CollectedBy, PaidAt
        )
        OUTPUT inserted.PaymentId
        VALUES (
          @paymentCode, @bookingId, @purpose, @method, @channel, @amount,
          @requestId, @bankTxnId, @collectedBy, @paidAt
        )
      `);

    return Number(res.recordset[0].PaymentId);
  }

  async updateBookingPaymentAndStatus(
    tx: TxContext,
    input: {
      bookingId: number;
      paidAmount: number;
      remainingAmount: number;
      status: BookingStatus;
      paymentStatus: PaymentStatus;
      holdExpireAt: Date | null;
      now: Date;
      expectedVersion?: Buffer;
    },
  ): Promise<Buffer> {
    const req = tx
      .request()
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('paidAmount', sql.Decimal(18, 0), input.paidAmount)
      .input('remainingAmount', sql.Decimal(18, 0), input.remainingAmount)
      .input('status', sql.VarChar(20), input.status)
      .input('paymentStatus', sql.VarChar(20), input.paymentStatus)
      .input('holdExpireAt', sql.DateTime2(0), input.holdExpireAt ? toSqlDateTime(input.holdExpireAt) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(input.now));

    let whereClause = 'WHERE BookingId = @bookingId';
    if (input.expectedVersion) {
      req.input('ver', sql.VarBinary(8), input.expectedVersion);
      whereClause += ' AND RowVer = @ver';
    }

    const res = await req.query<{ RowVer: Buffer }>(`
      UPDATE dbo.Bookings
      SET PaidAmount = @paidAmount,
          RemainingAmount = @remainingAmount,
          Status = @status,
          PaymentStatus = @paymentStatus,
          HoldExpireAt = @holdExpireAt,
          UpdatedAt = @now
      OUTPUT inserted.RowVer
      ${whereClause}
    `);

    if (!res.recordset[0]) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    return res.recordset[0].RowVer;
  }

  async updateBookingCanceled(
    tx: TxContext,
    input: {
      bookingId: number;
      expectedVersion: Buffer;
      cancelType: CancelType;
      cancelReason: string;
      canceledBy: number | null;
      canceledAt: Date;
      refundRate: number | null;
      refundAmount: number | null;
    },
  ): Promise<Buffer> {
    const res = await tx
      .request()
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('ver', sql.VarBinary(8), input.expectedVersion)
      .input('cancelType', sql.VarChar(20), input.cancelType)
      .input('cancelReason', sql.NVarChar(255), input.cancelReason)
      .input('canceledBy', sql.BigInt, input.canceledBy)
      .input('canceledAt', sql.DateTime2(0), toSqlDateTime(input.canceledAt))
      .input('refundRate', sql.Decimal(5, 2), input.refundRate)
      .input('refundAmount', sql.Decimal(18, 0), input.refundAmount)
      .query<{ RowVer: Buffer }>(`
        UPDATE dbo.Bookings
        SET Status = 'CANCELED',
            HoldExpireAt = NULL,
            CancelType = @cancelType,
            CancelReason = @cancelReason,
            CanceledBy = @canceledBy,
            CanceledAt = @canceledAt,
            RefundRate = @refundRate,
            RefundAmount = @refundAmount,
            UpdatedAt = @canceledAt
        OUTPUT inserted.RowVer
        WHERE BookingId = @bookingId
          AND RowVer = @ver
          AND Status IN ('PENDING_PAYMENT', 'CONFIRMED')
      `);

    if (!res.recordset[0]) {
      throw new AppError('BOOKING_STATE_CHANGED');
    }

    return res.recordset[0].RowVer;
  }

  async updateBookingExpired(
    tx: TxContext,
    bookingId: number,
    now: Date,
  ): Promise<Buffer | null> {
    const res = await tx
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<{ RowVer: Buffer }>(`
        UPDATE dbo.Bookings
        SET Status = 'EXPIRED',
            HoldExpireAt = NULL,
            UpdatedAt = @now
        OUTPUT inserted.RowVer
        WHERE BookingId = @bookingId
          AND Status = 'PENDING_PAYMENT'
          AND HoldExpireAt < @now
      `);

    return res.recordset[0]?.RowVer ?? null;
  }

  async insertRefund(
    tx: TxContext,
    input: {
      bookingId: number;
      amount: number;
      rate: number;
      reason: string;
      now: Date;
    },
  ): Promise<number> {
    const res = await tx
      .request()
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('amount', sql.Decimal(18, 0), input.amount)
      .input('rate', sql.Decimal(5, 2), input.rate)
      .input('reason', sql.NVarChar(255), input.reason)
      .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
      .query<{ RefundId: number | string }>(`
        INSERT INTO dbo.Refunds (BookingId, Amount, Rate, Reason, Status, CreatedAt)
        OUTPUT inserted.RefundId
        VALUES (@bookingId, @amount, @rate, @reason, 'PENDING', @now)
      `);

    return Number(res.recordset[0].RefundId);
  }

  async findExpiredPendingBookingCodes(
    exec: DbExecutor,
    now: Date,
    limit: number,
  ): Promise<string[]> {
    const res = await exec
      .request()
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .input('limit', sql.Int, limit)
      .query<{ BookingCode: string }>(`
        SELECT TOP (@limit) BookingCode
        FROM dbo.Bookings
        WHERE Status = 'PENDING_PAYMENT'
          AND HoldExpireAt < @now
        ORDER BY HoldExpireAt ASC
      `);

    return res.recordset.map((r) => r.BookingCode);
  }
}
