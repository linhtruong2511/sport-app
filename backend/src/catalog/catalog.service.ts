import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '@sporthub/shared/enums';
import { AvailabilityService } from '../availability/availability.service.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { formatDateVn } from '../core/time.js';
import {
  type BranchCatalogItem,
  type BranchSportStatItem,
  CatalogRepository,
  type SportCatalogItem,
} from './catalog.repository.js';

export interface BranchSportSummaryItem extends BranchSportStatItem {
  freeSlotCount: number;
}

export interface BranchSportSummaryResult {
  branch: {
    branchId: number;
    name: string;
    address: string;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
    holiday: {
      holidayId: number;
      startDate: string;
      endDate: string;
      reason: string | null;
    } | null;
  };
  sports: BranchSportSummaryItem[];
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly txService: DbTransactionService,
    private readonly repo: CatalogRepository,
    private readonly availabilityService: AvailabilityService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listBranches(
    status: 'ACTIVE' | 'ALL',
    callerRole?: UserRole,
  ): Promise<BranchCatalogItem[]> {
    if (status === 'ALL' && callerRole !== 'OWNER') {
      throw new AppError('FORBIDDEN');
    }
    const exec = await this.txService.executor();
    return this.repo.listBranches(exec, status === 'ALL');
  }

  async listSports(branchId?: number): Promise<SportCatalogItem[]> {
    const exec = await this.txService.executor();
    return this.repo.listSports(exec, branchId);
  }

  async getBranchSportSummary(
    branchId: number,
    date?: string,
  ): Promise<BranchSportSummaryResult> {
    const now = this.clock.now();
    const targetDate = date ?? formatDateVn(now);

    const [summary, exec] = await Promise.all([
      this.availabilityService.getBranchAvailabilitySummary(branchId, targetDate),
      this.txService.executor(),
    ]);

    const stats = await this.repo.getBranchSportStats(exec, branchId, now);

    return {
      branch: summary.branch,
      sports: stats.map((item) => ({
        ...item,
        freeSlotCount: summary.freeSlotCountBySportId.get(item.sportId) ?? 0,
      })),
    };
  }
}
