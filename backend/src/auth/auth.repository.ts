import { Injectable } from '@nestjs/common';
import type { UserRole, UserStatus } from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import { mapSqlError } from '../core/db/sql-errors.js';
import type { DbExecutor, TxContext } from '../core/db/transaction.js';
import { toSqlDateTime } from '../core/time.js';

export interface UserRow {
  UserId: number | string;
  Code: string;
  FullName: string;
  Phone: string;
  Email: string | null;
  PasswordHash: string;
  Role: UserRole;
  BranchId: number | null;
  BranchName: string | null;
  MemberTier: string | null;
  Status: UserStatus;
  FailedLoginCount: number;
  LockedUntil: Date | string | null;
  TokenVersion: number;
}

export interface AuthStatusRow {
  UserId: number | string;
  Role: UserRole;
  BranchId: number | null;
  Status: UserStatus;
  TokenVersion: number;
}

export interface ActiveRefreshTokenRow extends UserRow {
  TokenId: number | string;
  ExpiresAt: Date | string;
}

export interface CreateCustomerInput {
  code: string;
  fullName: string;
  phone: string;
  email: string;
  passwordHash: string;
  now: Date;
}

export interface InsertRefreshTokenInput {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  now: Date;
}

const USER_SELECT_COLUMNS = `
  u.UserId,
  u.Code,
  u.FullName,
  u.Phone,
  u.Email,
  u.PasswordHash,
  u.Role,
  u.BranchId,
  b.Name AS BranchName,
  u.MemberTier,
  u.Status,
  u.FailedLoginCount,
  u.LockedUntil,
  u.TokenVersion
`;

@Injectable()
export class AuthRepository {
  async findByIdentity(exec: DbExecutor, identity: string): Promise<UserRow | null> {
    const result = await exec
      .request()
      .input('identity', sql.NVarChar(255), identity)
      .query<UserRow>(`
        SELECT ${USER_SELECT_COLUMNS}
        FROM dbo.Users u
        LEFT JOIN dbo.Branches b ON b.BranchId = u.BranchId
        WHERE u.Phone = @identity OR LOWER(u.Email) = LOWER(@identity)
      `);

    return result.recordset[0] ?? null;
  }

  async findById(exec: DbExecutor, userId: number): Promise<UserRow | null> {
    const result = await exec
      .request()
      .input('userId', sql.BigInt, userId)
      .query<UserRow>(`
        SELECT ${USER_SELECT_COLUMNS}
        FROM dbo.Users u
        LEFT JOIN dbo.Branches b ON b.BranchId = u.BranchId
        WHERE u.UserId = @userId
      `);

    return result.recordset[0] ?? null;
  }

  async getAuthStatus(exec: DbExecutor, userId: number): Promise<AuthStatusRow | null> {
    const result = await exec
      .request()
      .input('userId', sql.BigInt, userId)
      .query<AuthStatusRow>(`
        SELECT UserId, Role, BranchId, Status, TokenVersion
        FROM dbo.Users
        WHERE UserId = @userId
      `);

    return result.recordset[0] ?? null;
  }

  async updateLoginFailure(
    tx: TxContext,
    userId: number,
    nextCount: number,
    lockedUntil: Date | null,
    now: Date,
  ): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('cnt', sql.TinyInt, nextCount)
      .input('lockedUntil', sql.DateTime2(0), lockedUntil ? toSqlDateTime(lockedUntil) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Users
        SET FailedLoginCount = @cnt,
            LockedUntil = @lockedUntil,
            UpdatedAt = @now
        WHERE UserId = @userId
      `);
  }

  async updateLoginSuccess(tx: TxContext, userId: number, now: Date): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Users
        SET FailedLoginCount = 0,
            LockedUntil = NULL,
            LastLoginAt = @now,
            UpdatedAt = @now
        WHERE UserId = @userId
      `);
  }

  async createCustomer(tx: TxContext, input: CreateCustomerInput): Promise<number> {
    try {
      const result = await tx
        .request()
        .input('code', sql.VarChar(20), input.code)
        .input('fullName', sql.NVarChar(100), input.fullName)
        .input('phone', sql.VarChar(10), input.phone)
        .input('email', sql.VarChar(255), input.email)
        .input('passwordHash', sql.VarChar(255), input.passwordHash)
        .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
        .query<{ UserId: number | string }>(`
          INSERT INTO dbo.Users (
            Code,
            FullName,
            Phone,
            Email,
            PasswordHash,
            Role,
            BranchId,
            Status,
            CreatedAt,
            UpdatedAt
          )
          OUTPUT inserted.UserId
          VALUES (
            @code,
            @fullName,
            @phone,
            @email,
            @passwordHash,
            'CUSTOMER',
            NULL,
            'ACTIVE',
            @now,
            @now
          )
        `);

      return Number(result.recordset[0].UserId);
    } catch (err) {
      mapSqlError(err);
    }
  }

  async insertRefreshToken(tx: TxContext, input: InsertRefreshTokenInput): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, input.userId)
      .input('tokenHash', sql.VarChar(128), input.tokenHash)
      .input('expiresAt', sql.DateTime2(0), toSqlDateTime(input.expiresAt))
      .input('userAgent', sql.NVarChar(500), input.userAgent ? input.userAgent.slice(0, 500) : null)
      .input('ipAddress', sql.VarChar(45), input.ipAddress ? input.ipAddress.slice(0, 45) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(input.now))
      .query(`
        INSERT INTO dbo.RefreshTokens (
          UserId,
          TokenHash,
          ExpiresAt,
          UserAgent,
          IpAddress,
          CreatedAt
        )
        VALUES (
          @userId,
          @tokenHash,
          @expiresAt,
          @userAgent,
          @ipAddress,
          @now
        )
      `);
  }

  async findActiveRefreshToken(
    exec: DbExecutor,
    tokenHash: string,
    now: Date,
  ): Promise<ActiveRefreshTokenRow | null> {
    const result = await exec
      .request()
      .input('tokenHash', sql.VarChar(128), tokenHash)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<ActiveRefreshTokenRow>(`
        SELECT
          rt.TokenId,
          rt.ExpiresAt,
          ${USER_SELECT_COLUMNS}
        FROM dbo.RefreshTokens rt
        INNER JOIN dbo.Users u ON u.UserId = rt.UserId
        LEFT JOIN dbo.Branches b ON b.BranchId = u.BranchId
        WHERE rt.TokenHash = @tokenHash
          AND rt.RevokedAt IS NULL
          AND rt.ExpiresAt > @now
      `);

    return result.recordset[0] ?? null;
  }

  async revokeRefreshToken(tx: TxContext, tokenId: number, now: Date): Promise<boolean> {
    const result = await tx
      .request()
      .input('tokenId', sql.BigInt, tokenId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.RefreshTokens
        SET RevokedAt = @now
        WHERE TokenId = @tokenId
          AND RevokedAt IS NULL
      `);

    return (result.rowsAffected[0] ?? 0) > 0;
  }

  async revokeRefreshTokenByHash(tx: TxContext, tokenHash: string, now: Date): Promise<void> {
    await tx
      .request()
      .input('tokenHash', sql.VarChar(128), tokenHash)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.RefreshTokens
        SET RevokedAt = @now
        WHERE TokenHash = @tokenHash
          AND RevokedAt IS NULL
      `);
  }

  async revokeAllUserRefreshTokens(tx: TxContext, userId: number, now: Date): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.RefreshTokens
        SET RevokedAt = @now
        WHERE UserId = @userId
          AND RevokedAt IS NULL
      `);
  }

  async incrementTokenVersion(tx: TxContext, userId: number, now: Date): Promise<void> {
    await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Users
        SET TokenVersion = TokenVersion + 1,
            UpdatedAt = @now
        WHERE UserId = @userId
      `);
  }
}
