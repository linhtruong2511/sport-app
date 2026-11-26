import { Inject, Injectable } from '@nestjs/common';
import type { BranchStatus } from '@sporthub/shared/enums';
import type { AdminBranchDto } from '@sporthub/shared/types';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthenticatedUser } from '../../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { DbTransactionService, type TxContext } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import { AdminBranchesRepository, type BranchWriteInput } from './admin-branches.repository.js';
import type { CreateBranchDto, UpdateBranchDto } from './admin-branches.schemas.js';

function toWriteInput(dto: UpdateBranchDto): BranchWriteInput {
  return {
    name: dto.name,
    address: dto.address,
    phone: dto.phone ?? null,
    description: dto.description ?? null,
    bankBin: dto.bankBin ?? null,
    bankName: dto.bankName ?? null,
    bankAccountNo: dto.bankAccountNo ?? null,
    bankAccountName: dto.bankAccountName ?? null,
  };
}

/** R-17 — Quản lý cơ sở (ngoài 73 API của SDD): EXT-01..04. */
@Injectable()
export class AdminBranchesService {
  constructor(
    private readonly repo: AdminBranchesRepository,
    private readonly auditService: AuditService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // EXT-01
  async listBranches(): Promise<AdminBranchDto[]> {
    const exec = await this.txService.executor();
    return this.repo.listBranches(exec, this.clock.now());
  }

  // EXT-02 — tạo cơ sở + giờ mở cửa mặc định trong một transaction.
  async createBranch(
    dto: CreateBranchDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminBranchDto> {
    const now = this.clock.now();
    return this.txService.withTransaction(async (tx) => {
      const branchId = await this.repo.insertBranch(
        tx,
        { ...toWriteInput(dto), code: dto.code },
        now,
      );
      await this.repo.insertDefaultOpeningHours(tx, branchId);

      const created = await this.mustFind(tx, branchId, now);
      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'CREATE_BRANCH',
        entityType: 'Branches',
        entityId: branchId,
        oldValue: null,
        newValue: created,
        ipAddress,
      });
      return created;
    });
  }

  // EXT-03 — Mã cơ sở và trạng thái không đổi qua API này.
  async updateBranch(
    branchId: number,
    dto: UpdateBranchDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminBranchDto> {
    const now = this.clock.now();
    return this.txService.withTransaction(async (tx) => {
      if (!(await this.repo.lockBranch(tx, branchId))) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy cơ sở.');
      }
      const before = await this.mustFind(tx, branchId, now);
      await this.repo.updateBranch(tx, branchId, toWriteInput(dto), now);
      const after = await this.mustFind(tx, branchId, now);

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'UPDATE_BRANCH',
        entityType: 'Branches',
        entityId: branchId,
        oldValue: before,
        newValue: after,
        ipAddress,
      });
      return after;
    });
  }

  // EXT-04 — R-17: không ngừng được khi còn đơn PENDING_PAYMENT / CONFIRMED / IN_USE.
  async deactivateBranch(
    branchId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminBranchDto> {
    return this.changeStatus(branchId, 'INACTIVE', caller, ipAddress);
  }

  // EXT-04
  async activateBranch(
    branchId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminBranchDto> {
    return this.changeStatus(branchId, 'ACTIVE', caller, ipAddress);
  }

  private async changeStatus(
    branchId: number,
    status: BranchStatus,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminBranchDto> {
    const now = this.clock.now();
    return this.txService.withTransaction(async (tx) => {
      if (!(await this.repo.lockBranch(tx, branchId))) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy cơ sở.');
      }
      const before = await this.mustFind(tx, branchId, now);
      if (before.status === status) {
        return before;
      }

      if (status === 'INACTIVE') {
        const activeBookingCount = await this.repo.countActiveBookings(tx, branchId);
        if (activeBookingCount > 0) {
          throw new AppError('BRANCH_HAS_ACTIVE_BOOKINGS', {
            message: `Cơ sở còn ${activeBookingCount} đơn đặt sân đang hiệu lực, vui lòng xử lý hết các đơn trước khi ngừng hoạt động.`,
            details: { activeBookingCount },
          });
        }
      }

      await this.repo.updateStatus(tx, branchId, status, now);
      const after = await this.mustFind(tx, branchId, now);
      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: status === 'INACTIVE' ? 'DEACTIVATE_BRANCH' : 'ACTIVATE_BRANCH',
        entityType: 'Branches',
        entityId: branchId,
        oldValue: { status: before.status },
        newValue: { status: after.status },
        ipAddress,
      });
      return after;
    });
  }

  private async mustFind(tx: TxContext, branchId: number, now: Date): Promise<AdminBranchDto> {
    const branch = await this.repo.findBranchById(tx, branchId, now);
    if (!branch) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy cơ sở.');
    }
    return branch;
  }
}
