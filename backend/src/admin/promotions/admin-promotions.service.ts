import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PromotionNotifyStatus } from '@sporthub/shared/enums';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthenticatedUser } from '../../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { DbTransactionService, type TxContext } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import { AppLogger } from '../../core/logger.js';
import { formatDateVn } from '../../core/time.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  type AdminPromotionDetailDto,
  type AdminPromotionDto,
  AdminPromotionsRepository,
} from './admin-promotions.repository.js';
import type {
  CreatePromotionDto,
  ListPromotionsQuery,
  UpdatePromotionDto,
} from './admin-promotions.schemas.js';

function buildPromoNotificationBody(promo: AdminPromotionDetailDto): string {
  if (promo.description && promo.description.trim().length > 0) {
    return promo.description.trim().slice(0, 1000);
  }
  const discountLabel =
    promo.discountType === 'PERCENT'
      ? `giảm ${promo.discountValue}%${
          promo.maxDiscountAmount !== null
            ? ` (tối đa ${promo.maxDiscountAmount.toLocaleString('vi-VN')}đ)`
            : ''
        }`
      : `giảm ${promo.discountValue.toLocaleString('vi-VN')}đ`;
  const timeLabel =
    promo.timeFrom && promo.timeTo ? ` khung ${promo.timeFrom}–${promo.timeTo}` : '';
  return `Nhập mã ${promo.code} ${discountLabel}${timeLabel}, áp dụng từ ${promo.startDate} đến ${promo.endDate}.`.slice(
    0,
    1000,
  );
}

@Injectable()
export class AdminPromotionsService {
  constructor(
    private readonly repo: AdminPromotionsRepository,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly logger?: AppLogger,
  ) {}

  // API-59, UC 022
  async listPromotions(query: ListPromotionsQuery) {
    const exec = await this.txService.executor();
    const todayVn = formatDateVn(this.clock.now());
    return this.repo.listPromotions(exec, query, todayVn);
  }

  // API-60, UC 022
  async getPromotionDetail(promotionId: number): Promise<AdminPromotionDetailDto> {
    const exec = await this.txService.executor();
    const todayVn = formatDateVn(this.clock.now());
    const promo = await this.repo.getPromotionDetail(exec, promotionId, todayVn);
    if (!promo) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chương trình khuyến mãi.');
    }
    return promo;
  }

  // API-61, UC 022
  async createPromotion(
    dto: CreatePromotionDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminPromotionDto> {
    const now = this.clock.now();
    const todayVn = formatDateVn(now);
    const branchIds = dto.allBranches ? [] : Array.from(new Set(dto.branchIds));
    const sportIds = dto.allSports ? [] : Array.from(new Set(dto.sportIds));
    const customerPhones =
      dto.audienceType === 'SPECIFIC' ? Array.from(new Set(dto.customerPhones)) : [];
    const maxDiscountAmount =
      dto.discountType === 'PERCENT' ? (dto.maxDiscountAmount ?? null) : null;
    const notifyStatus: PromotionNotifyStatus = dto.notifyCustomers ? 'PENDING' : 'NONE';

    const created = await this.txService.withTransaction(async (tx) => {
      await this.validateScopeAndCode(tx, {
        code: dto.code,
        branchIds,
        sportIds,
      });

      const customerIds = await this.resolveCustomerIds(tx, dto.audienceType, customerPhones);

      const promotionId = await this.repo.insertPromotion(tx, {
        code: dto.code,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountAmount,
        allBranches: dto.allBranches,
        allSports: dto.allSports,
        timeFrom: dto.timeFrom ?? null,
        timeTo: dto.timeTo ?? null,
        startDate: dto.startDate,
        endDate: dto.endDate,
        audienceType: dto.audienceType,
        maxUses: dto.maxUses,
        notifyStatus,
        createdBy: caller.userId,
        now,
      });

      await this.repo.replacePromotionRelations(tx, promotionId, {
        branchIds,
        sportIds,
        customerIds,
      });

      const detail = await this.repo.getPromotionDetail(tx, promotionId, todayVn);
      if (!detail) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'CREATE_PROMOTION',
        entityType: 'Promotions',
        entityId: promotionId,
        oldValue: null,
        newValue: detail,
        ipAddress,
      });

      return detail;
    });

    if (dto.notifyCustomers) {
      try {
        await this.dispatchPromoNotifications(created.promotionId);
      } catch (err) {
        this.logger?.error('Post-commit promo notification dispatch failed', {
          context: 'AdminPromotionsService',
          promotionId: created.promotionId,
          err,
        });
      }
    }

    return created;
  }

  // API-62, UC 022
  async updatePromotion(
    promotionId: number,
    dto: UpdatePromotionDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminPromotionDto> {
    const now = this.clock.now();
    const todayVn = formatDateVn(now);
    const branchIds = dto.allBranches ? [] : Array.from(new Set(dto.branchIds));
    const sportIds = dto.allSports ? [] : Array.from(new Set(dto.sportIds));
    const customerPhones =
      dto.audienceType === 'SPECIFIC' ? Array.from(new Set(dto.customerPhones)) : [];
    const maxDiscountAmount =
      dto.discountType === 'PERCENT' ? (dto.maxDiscountAmount ?? null) : null;

    return this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.getPromotionDetail(tx, promotionId, todayVn);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chương trình khuyến mãi.');
      }

      if (existing.status === 'DISCONTINUED') {
        throw new AppError('PROMO_DISCONTINUED');
      }

      if (existing.usedCount > 0 && dto.code !== existing.code) {
        throw new AppError('PROMO_CODE_LOCKED');
      }

      if (dto.maxUses < existing.usedCount) {
        throw new AppError('MAX_USES_TOO_LOW');
      }

      await this.validateScopeAndCode(tx, {
        code: dto.code,
        excludePromotionId: promotionId,
        branchIds,
        sportIds,
      });

      const customerIds = await this.resolveCustomerIds(tx, dto.audienceType, customerPhones);

      await this.repo.updatePromotion(tx, {
        promotionId,
        code: dto.code,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountAmount,
        allBranches: dto.allBranches,
        allSports: dto.allSports,
        timeFrom: dto.timeFrom ?? null,
        timeTo: dto.timeTo ?? null,
        startDate: dto.startDate,
        endDate: dto.endDate,
        audienceType: dto.audienceType,
        maxUses: dto.maxUses,
        now,
      });

      await this.repo.replacePromotionRelations(tx, promotionId, {
        branchIds,
        sportIds,
        customerIds,
      });

      const refreshed = await this.repo.getPromotionDetail(tx, promotionId, todayVn);
      if (!refreshed) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'UPDATE_PROMOTION',
        entityType: 'Promotions',
        entityId: promotionId,
        oldValue: existing,
        newValue: refreshed,
        ipAddress,
      });

      return refreshed;
    });
  }

  // API-63, UC 022
  async pausePromotion(
    promotionId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<{ promotionId: number; status: 'PAUSED' }> {
    return this.changePromotionStatus(promotionId, 'PAUSED', 'PAUSE_PROMOTION', caller, ipAddress);
  }

  // API-63, UC 022
  async resumePromotion(
    promotionId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<{ promotionId: number; status: 'ACTIVE' }> {
    return this.changePromotionStatus(promotionId, 'ACTIVE', 'RESUME_PROMOTION', caller, ipAddress);
  }

  // API-64, UC 022
  async deletePromotion(
    promotionId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<
    | { promotionId: number; deleted: true }
    | { promotionId: number; deleted: false; status: 'DISCONTINUED'; message: string }
  > {
    const now = this.clock.now();
    const todayVn = formatDateVn(now);

    return this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.getPromotionDetail(tx, promotionId, todayVn);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chương trình khuyến mãi.');
      }

      if (existing.usedCount === 0) {
        await this.repo.deletePromotionHard(tx, promotionId);
        await this.auditService.writeInTx(tx, {
          userId: caller.userId,
          action: 'DELETE_PROMOTION',
          entityType: 'Promotions',
          entityId: promotionId,
          oldValue: existing,
          newValue: null,
          ipAddress,
        });
        return { promotionId, deleted: true as const };
      }

      await this.repo.updateStatus(tx, promotionId, 'DISCONTINUED', now);
      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'DISCONTINUE_PROMOTION',
        entityType: 'Promotions',
        entityId: promotionId,
        oldValue: { status: existing.status },
        newValue: { status: 'DISCONTINUED' },
        ipAddress,
      });

      return {
        promotionId,
        deleted: false as const,
        status: 'DISCONTINUED' as const,
        message: `Mã ${existing.code} đã có ${existing.usedCount} lượt sử dụng nên chuyển sang Ngừng áp dụng.`,
      };
    });
  }

  // API-65, UC 022-3a
  async notifyPromotion(
    promotionId: number,
  ): Promise<{ promotionId: number; notifyStatus: PromotionNotifyStatus; sentCount: number }> {
    const exec = await this.txService.executor();
    const todayVn = formatDateVn(this.clock.now());
    const existing = await this.repo.getPromotionDetail(exec, promotionId, todayVn);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chương trình khuyến mãi.');
    }
    if (existing.status === 'DISCONTINUED') {
      throw new AppError('PROMO_DISCONTINUED');
    }

    await this.repo.updateNotifyStatus(exec, promotionId, 'PENDING', this.clock.now());
    return this.dispatchPromoNotifications(promotionId);
  }

  // SDD 2.8 & API-61/65: idempotent dispatch per (UserId, Type='PROMOTION', LinkType='PROMOTION', LinkRef=promo.Code)
  async dispatchPromoNotifications(
    promotionId: number,
  ): Promise<{ promotionId: number; notifyStatus: 'SENT' | 'FAILED'; sentCount: number }> {
    const now = this.clock.now();
    const todayVn = formatDateVn(now);

    try {
      const sentCount = await this.txService.withTransaction(async (tx) => {
        const promo = await this.repo.getPromotionDetail(tx, promotionId, todayVn);
        if (!promo) {
          throw new AppError('NOT_FOUND', 'Không tìm thấy chương trình khuyến mãi.');
        }

        const targetUserIds = await this.repo.findTargetCustomerIdsForPromo(
          tx,
          promotionId,
          promo.audienceType,
        );
        const alreadyNotified = await this.repo.findAlreadyNotifiedUserIds(
          tx,
          promotionId,
          promo.code,
        );

        const title = promo.name.slice(0, 150);
        const body = buildPromoNotificationBody(promo);

        let sent = 0;
        for (const userId of targetUserIds) {
          if (alreadyNotified.has(userId)) {
            continue;
          }
          await this.notificationsService.createNotificationInTx(tx, {
            userId,
            type: 'PROMOTION',
            title,
            body,
            linkType: 'PROMOTION',
            linkRef: promo.code,
            promotionCode: promo.code,
          });
          sent += 1;
        }

        await this.repo.updateNotifyStatus(tx, promotionId, 'SENT', now);
        return sent;
      });

      return {
        promotionId,
        notifyStatus: 'SENT',
        sentCount,
      };
    } catch (err) {
      this.logger?.error('dispatchPromoNotifications failed', {
        context: 'AdminPromotionsService',
        promotionId,
        err,
      });
      const exec = await this.txService.executor();
      await this.repo.updateNotifyStatus(exec, promotionId, 'FAILED', this.clock.now()).catch(() => undefined);
      return {
        promotionId,
        notifyStatus: 'FAILED',
        sentCount: 0,
      };
    }
  }

  // SDD 2.8: retryPromoNotify background job handler
  async retryFailedPromoNotifications(batchSize = 20): Promise<number> {
    const exec = await this.txService.executor();
    const promoIds = await this.repo.listFailedNotifyPromotionIds(exec, batchSize);
    let succeeded = 0;

    for (const promotionId of promoIds) {
      const result = await this.dispatchPromoNotifications(promotionId);
      if (result.notifyStatus === 'SENT') {
        succeeded += 1;
      }
    }

    return succeeded;
  }

  private async changePromotionStatus<S extends 'ACTIVE' | 'PAUSED'>(
    promotionId: number,
    targetStatus: S,
    action: string,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<{ promotionId: number; status: S }> {
    const now = this.clock.now();
    const todayVn = formatDateVn(now);

    return this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.getPromotionDetail(tx, promotionId, todayVn);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chương trình khuyến mãi.');
      }
      if (existing.status === 'DISCONTINUED') {
        throw new AppError('PROMO_DISCONTINUED');
      }

      await this.repo.updateStatus(tx, promotionId, targetStatus, now);

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action,
        entityType: 'Promotions',
        entityId: promotionId,
        oldValue: { status: existing.status },
        newValue: { status: targetStatus },
        ipAddress,
      });

      return { promotionId, status: targetStatus };
    });
  }

  private async validateScopeAndCode(
    tx: TxContext,
    params: {
      code: string;
      excludePromotionId?: number;
      branchIds: number[];
      sportIds: number[];
    },
  ): Promise<void> {
    if (params.branchIds.length > 0) {
      const missingBranches = await this.repo.findMissingBranchIds(tx, params.branchIds);
      if (missingBranches.length > 0) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
      }
    }

    if (params.sportIds.length > 0) {
      const missingSports = await this.repo.findMissingSportIds(tx, params.sportIds);
      if (missingSports.length > 0) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy bộ môn.');
      }
    }

    const codeExists = await this.repo.existsCode(
      tx,
      params.code,
      params.excludePromotionId,
    );
    if (codeExists) {
      throw new AppError('PROMO_CODE_DUPLICATE', 'Mã giảm giá này đã tồn tại.');
    }
  }

  private async resolveCustomerIds(
    tx: TxContext,
    audienceType: 'ALL' | 'SPECIFIC',
    phones: string[],
  ): Promise<number[]> {
    if (audienceType !== 'SPECIFIC') {
      return [];
    }

    const found = await this.repo.findCustomersByPhones(tx, phones);
    const byPhone = new Map(found.map((c) => [c.phone, c.userId]));
    const missingPhones = phones.filter((phone) => !byPhone.has(phone));

    if (missingPhones.length > 0) {
      throw new AppError('CUSTOMER_NOT_FOUND', {
        details: { phones: missingPhones },
      });
    }

    return phones.map((phone) => byPhone.get(phone)!);
  }
}
