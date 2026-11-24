import { Inject, Injectable } from '@nestjs/common';
import type { AudienceType, DiscountType, PromotionStatus } from '@sporthub/shared/enums';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { formatDateVn } from '../core/time.js';
import { PromotionsRepository, type PublicPromotionRow } from './promotions.repository.js';

export interface PublicPromotionDto {
  promotionId: number;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  timeFrom: string | null;
  timeTo: string | null;
  startDate: string;
  endDate: string;
  scopeText: string;
  branchIds: number[];
  sportIds: number[];
  audienceType: AudienceType;
  remainingUses: number;
}

export interface PublicPromotionCheckDto {
  code: string;
  name: string;
  status: PromotionStatus;
  endDate: string;
  usable: boolean;
  message: string | null;
}

function buildScopeText(row: PublicPromotionRow): string {
  if (row.allBranches && row.allSports) {
    return 'Tất cả cơ sở';
  }
  const parts: string[] = [];
  if (row.allBranches) {
    parts.push('Tất cả cơ sở');
  } else if (row.branchNames.length > 0) {
    parts.push(row.branchNames.join(', '));
  }
  if (!row.allSports && row.sportNames.length > 0) {
    parts.push(row.sportNames.join(', '));
  }
  return parts.join(' • ') || 'Tất cả cơ sở';
}

@Injectable()
export class PromotionsService {
  constructor(
    private readonly txService: DbTransactionService,
    private readonly repo: PromotionsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listPublicPromotions(params: {
    branchId?: number;
    sportId?: number;
    limit: number;
    callerUserId?: number;
  }): Promise<PublicPromotionDto[]> {
    const today = formatDateVn(this.clock.now());
    const exec = await this.txService.executor();

    const rows = await this.repo.listPublicPromotions(exec, {
      today,
      branchId: params.branchId,
      sportId: params.sportId,
      userId: params.callerUserId,
      limit: params.limit,
    });

    return rows.map((row) => ({
      promotionId: row.promotionId,
      code: row.code,
      name: row.name,
      discountType: row.discountType,
      discountValue: row.discountValue,
      maxDiscountAmount: row.maxDiscountAmount,
      timeFrom: row.timeFrom,
      timeTo: row.timeTo,
      startDate: row.startDate,
      endDate: row.endDate,
      scopeText: buildScopeText(row),
      branchIds: row.branchIds,
      sportIds: row.sportIds,
      audienceType: row.audienceType,
      remainingUses: row.remainingUses,
    }));
  }

  async getPublicPromotionByCode(
    code: string,
    callerUserId?: number,
  ): Promise<PublicPromotionCheckDto> {
    const exec = await this.txService.executor();
    const promo = await this.repo.findPublicByCode(exec, code, callerUserId);
    if (!promo) {
      throw new AppError('PROMO_NOT_FOUND');
    }

    const today = formatDateVn(this.clock.now());
    let usable = true;
    let message: string | null = null;

    if (
      promo.status !== 'ACTIVE' ||
      today > promo.endDate ||
      today < promo.startDate ||
      promo.usedCount >= promo.maxUses
    ) {
      usable = false;
      message = 'Chương trình ưu đãi đã kết thúc.';
    } else if (promo.audienceType === 'SPECIFIC' && !promo.isCustomerEligible) {
      usable = false;
      message = 'Mã chỉ dành cho khách hàng được chỉ định.';
    }

    return {
      code: promo.code,
      name: promo.name,
      status: promo.status,
      endDate: promo.endDate,
      usable,
      message,
    };
  }
}
