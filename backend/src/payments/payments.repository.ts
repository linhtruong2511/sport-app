import { Injectable } from '@nestjs/common';
import type {
  BankMatchStatus,
  BookingStatus,
  PaymentPurpose,
  PaymentRequestStatus,
  PaymentStatus,
} from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import { getSqlErrorMessage, isSqlUniqueViolation } from '../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../core/db/transaction.js';
import { toSqlDateTime } from '../core/time.js';

export interface BranchBankInfoRow {
  BranchId: number;
  BankBin: string | null;
  BankName: string | null;
  BankAccountNo: string | null;
  BankAccountName: string | null;
}

export interface BranchByAccountRow extends BranchBankInfoRow {
  Code: string;
  Name: string;
}

export interface PaymentRequestRow {
  RequestId: number | string;
  BookingId: number | string;
  BookingCode: string;
  Purpose: PaymentPurpose;
  Amount: number | string;
  TransferContent: string;
  QrPayload: string;
  ExpiresAt: Date | string;
  Status: PaymentRequestStatus;
  BankBin: string | null;
  BankName: string | null;
  BankAccountNo: string | null;
  BankAccountName: string | null;
}

export interface PaymentRequestWithBookingRow extends PaymentRequestRow {
  BranchId: number;
  CustomerUserId: number | string | null;
  BookingStatus: BookingStatus;
  PaymentStatus: PaymentStatus;
  HoldExpireAt: Date | string | null;
  AmountDueNow: number | string;
  PaidAmount: number | string;
  RemainingAmount: number | string;
  RowVer: Buffer;
}

export interface ExpiredPaymentRequestRow {
  RequestId: number | string;
  BookingId: number | string;
  BookingCode: string;
}

export interface InsertPaymentRequestInput {
  bookingId: number;
  purpose: PaymentPurpose;
  amount: number;
  transferContent: string;
  qrPayload: string;
  expiresAt: Date;
  createdBy: number | null;
  createdAt: Date;
}

export interface InsertBankTransactionInput {
  provider: string;
  providerTxnId: string;
  accountNo: string;
  amount: number;
  content: string | null;
  transactionAt: Date;
  rawPayload: string;
  receivedAt: Date;
}

@Injectable()
export class PaymentsRepository {
  async getBranchBankInfo(exec: DbExecutor, branchId: number): Promise<BranchBankInfoRow | null> {
    const res = await exec
      .request()
      .input('branchId', sql.Int, branchId)
      .query<BranchBankInfoRow>(`
        SELECT BranchId, BankBin, BankName, BankAccountNo, BankAccountName
        FROM dbo.Branches
        WHERE BranchId = @branchId
      `);

    return res.recordset[0] ?? null;
  }

  async findBranchByBankAccountNo(
    exec: DbExecutor,
    accountNo: string,
  ): Promise<BranchByAccountRow | null> {
    const res = await exec
      .request()
      .input('accountNo', sql.VarChar(30), accountNo)
      .query<BranchByAccountRow>(`
        SELECT BranchId, Code, Name, BankBin, BankName, BankAccountNo, BankAccountName
        FROM dbo.Branches
        WHERE BankAccountNo = @accountNo
      `);

    return res.recordset[0] ?? null;
  }

  async findPendingRequestByBookingId(
    exec: DbExecutor,
    bookingId: number,
  ): Promise<PaymentRequestRow | null> {
    const res = await exec
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query<PaymentRequestRow>(`
        SELECT TOP 1
          pr.RequestId,
          pr.BookingId,
          b.BookingCode,
          pr.Purpose,
          pr.Amount,
          pr.TransferContent,
          pr.QrPayload,
          pr.ExpiresAt,
          pr.Status,
          br.BankBin,
          br.BankName,
          br.BankAccountNo,
          br.BankAccountName
        FROM dbo.PaymentRequest pr
        INNER JOIN dbo.Bookings b ON b.BookingId = pr.BookingId
        INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
        WHERE pr.BookingId = @bookingId
          AND pr.Status = 'PENDING'
        ORDER BY pr.RequestId DESC
      `);

    return res.recordset[0] ?? null;
  }

  async findRequestById(
    exec: DbExecutor,
    requestId: number,
  ): Promise<PaymentRequestWithBookingRow | null> {
    const res = await exec
      .request()
      .input('requestId', sql.BigInt, requestId)
      .query<PaymentRequestWithBookingRow>(`
        SELECT
          pr.RequestId,
          pr.BookingId,
          b.BookingCode,
          b.BranchId,
          b.CustomerUserId,
          b.Status AS BookingStatus,
          b.PaymentStatus,
          b.HoldExpireAt,
          b.AmountDueNow,
          b.PaidAmount,
          b.RemainingAmount,
          b.RowVer,
          pr.Purpose,
          pr.Amount,
          pr.TransferContent,
          pr.QrPayload,
          pr.ExpiresAt,
          pr.Status,
          br.BankBin,
          br.BankName,
          br.BankAccountNo,
          br.BankAccountName
        FROM dbo.PaymentRequest pr
        INNER JOIN dbo.Bookings b ON b.BookingId = pr.BookingId
        INNER JOIN dbo.Branches br ON br.BranchId = b.BranchId
        WHERE pr.RequestId = @requestId
      `);

    return res.recordset[0] ?? null;
  }

  async expirePendingRequestsByBookingId(tx: TxContext, bookingId: number): Promise<void> {
    await tx
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        UPDATE dbo.PaymentRequest
        SET Status = 'EXPIRED'
        WHERE BookingId = @bookingId
          AND Status = 'PENDING'
      `);
  }

  async cancelPendingRequestsByBookingId(tx: TxContext, bookingId: number): Promise<void> {
    await tx
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query(`
        UPDATE dbo.PaymentRequest
        SET Status = 'CANCELED'
        WHERE BookingId = @bookingId
          AND Status = 'PENDING'
      `);
  }

  async markRequestPaid(tx: TxContext, requestId: number): Promise<boolean> {
    const res = await tx
      .request()
      .input('requestId', sql.BigInt, requestId)
      .query(`
        UPDATE dbo.PaymentRequest
        SET Status = 'PAID'
        WHERE RequestId = @requestId
          AND Status = 'PENDING'
      `);

    return (res.rowsAffected[0] ?? 0) > 0;
  }

  async insertPaymentRequest(tx: TxContext, input: InsertPaymentRequestInput): Promise<number> {
    const res = await tx
      .request()
      .input('bookingId', sql.BigInt, input.bookingId)
      .input('purpose', sql.VarChar(20), input.purpose)
      .input('amount', sql.Decimal(18, 0), input.amount)
      .input('transferContent', sql.VarChar(50), input.transferContent)
      .input('qrPayload', sql.VarChar(1000), input.qrPayload)
      .input('expiresAt', sql.DateTime2(0), toSqlDateTime(input.expiresAt))
      .input('createdBy', sql.BigInt, input.createdBy)
      .input('createdAt', sql.DateTime2(0), toSqlDateTime(input.createdAt))
      .query<{ RequestId: number | string }>(`
        INSERT INTO dbo.PaymentRequest (
          BookingId, Purpose, Amount, TransferContent, QrPayload,
          ExpiresAt, Status, CreatedBy, CreatedAt
        )
        OUTPUT inserted.RequestId
        VALUES (
          @bookingId, @purpose, @amount, @transferContent, @qrPayload,
          @expiresAt, 'PENDING', @createdBy, @createdAt
        )
      `);

    return Number(res.recordset[0].RequestId);
  }

  async findExpiredPendingRequests(
    exec: DbExecutor,
    now: Date,
    limit: number,
  ): Promise<ExpiredPaymentRequestRow[]> {
    const res = await exec
      .request()
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .input('limit', sql.Int, limit)
      .query<ExpiredPaymentRequestRow>(`
        SELECT TOP (@limit) pr.RequestId, pr.BookingId, b.BookingCode
        FROM dbo.PaymentRequest pr
        INNER JOIN dbo.Bookings b ON b.BookingId = pr.BookingId
        WHERE pr.Status = 'PENDING'
          AND pr.ExpiresAt < @now
        ORDER BY pr.ExpiresAt ASC
      `);

    return res.recordset;
  }

  async markRequestExpiredById(tx: TxContext, requestId: number): Promise<boolean> {
    const res = await tx
      .request()
      .input('requestId', sql.BigInt, requestId)
      .query(`
        UPDATE dbo.PaymentRequest
        SET Status = 'EXPIRED'
        WHERE RequestId = @requestId
          AND Status = 'PENDING'
      `);

    return (res.rowsAffected[0] ?? 0) > 0;
  }

  async insertBankTransaction(
    tx: TxContext,
    input: InsertBankTransactionInput,
  ): Promise<{ bankTxnId: number | null; duplicated: boolean }> {
    try {
      const res = await tx
        .request()
        .input('provider', sql.VarChar(30), input.provider)
        .input('providerTxnId', sql.VarChar(100), input.providerTxnId)
        .input('accountNo', sql.VarChar(30), input.accountNo)
        .input('amount', sql.Decimal(18, 0), input.amount)
        .input('content', sql.NVarChar(500), input.content !== null ? input.content.slice(0, 500) : null)
        .input('transactionAt', sql.DateTime2(0), toSqlDateTime(input.transactionAt))
        .input('rawPayload', sql.NVarChar(sql.MAX), input.rawPayload)
        .input('receivedAt', sql.DateTime2(0), toSqlDateTime(input.receivedAt))
        .query<{ BankTxnId: number | string }>(`
          INSERT INTO dbo.BankTransactions (
            Provider, ProviderTxnId, AccountNo, Amount, Content,
            TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt
          )
          OUTPUT inserted.BankTxnId
          VALUES (
            @provider, @providerTxnId, @accountNo, @amount, @content,
            @transactionAt, @rawPayload, 'PENDING', NULL, @receivedAt
          )
        `);

      return { bankTxnId: Number(res.recordset[0].BankTxnId), duplicated: false };
    } catch (err) {
      if (isSqlUniqueViolation(err)) {
        const msg = getSqlErrorMessage(err);
        if (!msg || msg.includes('UQ_BankTransactions_Provider_Txn')) {
          return { bankTxnId: null, duplicated: true };
        }
        return { bankTxnId: null, duplicated: true };
      }
      throw err;
    }
  }

  async updateBankTransactionStatus(
    tx: TxContext,
    bankTxnId: number,
    input: { matchStatus: BankMatchStatus; matchedBookingId: number | null },
  ): Promise<void> {
    await tx
      .request()
      .input('bankTxnId', sql.BigInt, bankTxnId)
      .input('matchStatus', sql.VarChar(20), input.matchStatus)
      .input('matchedBookingId', sql.BigInt, input.matchedBookingId)
      .query(`
        UPDATE dbo.BankTransactions
        SET MatchStatus = @matchStatus,
            MatchedBookingId = @matchedBookingId
        WHERE BankTxnId = @bankTxnId
      `);
  }
}
