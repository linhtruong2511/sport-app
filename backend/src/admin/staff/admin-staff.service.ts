import { Inject, Injectable } from '@nestjs/common';
import { USER_ROLE_LABELS, type UserRole } from '@sporthub/shared/enums';
import bcrypt from 'bcryptjs';
import { AuthService } from '../../auth/auth.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthenticatedUser } from '../../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { nextCode } from '../../core/codes.js';
import { DbTransactionService, type TxContext } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import {
  type AdminStaffDto,
  type AdminStaffPaymentDto,
  AdminStaffRepository,
} from './admin-staff.repository.js';
import type {
  CreateStaffDto,
  ListStaffQuery,
  StaffPaymentsQuery,
  UpdateStaffDto,
} from './admin-staff.schemas.js';

function formatTakenRoleLabel(role: UserRole): string {
  return USER_ROLE_LABELS[role].toLowerCase();
}

@Injectable()
export class AdminStaffService {
  constructor(
    private readonly repo: AdminStaffRepository,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-42, UC 016
  async listStaff(query: ListStaffQuery) {
    const exec = await this.txService.executor();
    return this.repo.listStaff(exec, query);
  }

  // API-43, UC 016
  async createStaff(
    dto: CreateStaffDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminStaffDto> {
    const now = this.clock.now();
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const fullName = dto.fullName.trim();
    const phone = dto.phone.trim();
    const email = dto.email ? dto.email.trim() : null;

    return this.txService.withTransaction(async (tx) => {
      const branch = await this.repo.findBranchById(tx, dto.branchId);
      if (!branch) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
      }

      await this.ensurePhoneAndEmailUnique(tx, phone, email);

      const code = await nextCode(tx, 'NV', null);
      const userId = await this.repo.insertStaff(tx, {
        code,
        fullName,
        phone,
        email,
        passwordHash,
        branchId: dto.branchId,
        status: dto.status,
        now,
      });

      const created = await this.repo.findStaffById(tx, userId);
      if (!created) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'CREATE_STAFF',
        entityType: 'Users',
        entityId: userId,
        oldValue: null,
        newValue: created,
        ipAddress,
      });

      return created;
    });
  }

  // API-44, UC 016
  async updateStaff(
    userId: number,
    dto: UpdateStaffDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminStaffDto> {
    const now = this.clock.now();
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;
    const fullName = dto.fullName.trim();
    const phone = dto.phone.trim();
    const email = dto.email ? dto.email.trim() : null;

    return this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.findStaffById(tx, userId);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy nhân viên.');
      }

      const branch = await this.repo.findBranchById(tx, dto.branchId);
      if (!branch) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
      }

      await this.ensurePhoneAndEmailUnique(tx, phone, email, userId);

      const nextStatus = dto.status ?? existing.status;
      const branchChanged = existing.branch.branchId !== dto.branchId;
      const passwordChanged = passwordHash !== undefined;
      const lockedNow = existing.status !== 'LOCKED' && nextStatus === 'LOCKED';

      await this.repo.updateStaff(tx, {
        userId,
        fullName,
        phone,
        email,
        branchId: dto.branchId,
        status: nextStatus,
        passwordHash,
        now,
      });

      // SDD 5.7 & API-44: revoke active sessions when locked, branch changed, or password changed
      if (lockedNow) {
        await this.authService.revokeUserSessions(tx, userId, 'ACCOUNT_LOCKED');
      } else if (branchChanged) {
        await this.authService.revokeUserSessions(tx, userId, 'BRANCH_CHANGED');
      } else if (passwordChanged) {
        await this.authService.revokeUserSessions(tx, userId, 'PASSWORD_CHANGED');
      }

      const refreshed = await this.repo.findStaffById(tx, userId);
      if (!refreshed) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'UPDATE_STAFF',
        entityType: 'Users',
        entityId: userId,
        oldValue: existing,
        newValue: {
          ...refreshed,
          ...(passwordChanged ? { passwordChanged: true } : {}),
        },
        ipAddress,
      });

      return refreshed;
    });
  }

  // API-45, UC 016
  async lockStaff(
    userId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminStaffDto> {
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.findStaffById(tx, userId);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy nhân viên.');
      }

      await this.repo.lockStaff(tx, userId, now);
      await this.authService.revokeUserSessions(tx, userId, 'ACCOUNT_LOCKED');

      const refreshed = await this.repo.findStaffById(tx, userId);
      if (!refreshed) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'LOCK_STAFF',
        entityType: 'Users',
        entityId: userId,
        oldValue: { status: existing.status },
        newValue: { status: 'LOCKED' },
        ipAddress,
      });

      return refreshed;
    });
  }

  // API-45, UC 016
  async unlockStaff(
    userId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminStaffDto> {
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.findStaffById(tx, userId);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy nhân viên.');
      }

      await this.repo.unlockStaff(tx, userId, now);

      const refreshed = await this.repo.findStaffById(tx, userId);
      if (!refreshed) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'UNLOCK_STAFF',
        entityType: 'Users',
        entityId: userId,
        oldValue: { status: existing.status },
        newValue: { status: 'ACTIVE' },
        ipAddress,
      });

      return refreshed;
    });
  }

  // API-46, UC 016
  async listStaffPayments(
    userId: number,
    query: StaffPaymentsQuery,
  ): Promise<{
    items: AdminStaffPaymentDto[];
    totalItems: number;
    totalAmount: number;
  }> {
    if (query.from && query.to && query.from > query.to) {
      throw new AppError('INVALID_DATE_RANGE');
    }

    const exec = await this.txService.executor();
    const staff = await this.repo.findStaffById(exec, userId);
    if (!staff) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy nhân viên.');
    }

    return this.repo.listStaffPayments(exec, {
      userId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  private async ensurePhoneAndEmailUnique(
    tx: TxContext,
    phone: string,
    email: string | null,
    excludeUserId?: number,
  ): Promise<void> {
    const phoneConflict = await this.repo.findPhoneConflict(tx, phone, excludeUserId);
    if (phoneConflict) {
      throw new AppError('PHONE_TAKEN', {
        message: `Số điện thoại này đã được sử dụng bởi tài khoản ${formatTakenRoleLabel(phoneConflict.role)} khác.`,
        details: { takenByRole: phoneConflict.role },
      });
    }

    if (email !== null) {
      const emailConflict = await this.repo.findEmailConflict(tx, email, excludeUserId);
      if (emailConflict) {
        throw new AppError('EMAIL_TAKEN', {
          message: `Email này đã được sử dụng bởi tài khoản ${formatTakenRoleLabel(emailConflict.role)} khác.`,
          details: { takenByRole: emailConflict.role },
        });
      }
    }
  }
}
