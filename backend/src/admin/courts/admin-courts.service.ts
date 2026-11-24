import { Inject, Injectable } from '@nestjs/common';
import type { BlockType, DepositType } from '@sporthub/shared/enums';
import { AffectedBookingsService } from '../../affected-bookings/affected-bookings.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import type { AuthenticatedUser } from '../../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import type { DomainEvent } from '../../core/realtime/realtime.service.js';
import {
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
  toIsoVn,
  toSqlDate,
} from '../../core/time.js';
import {
  AdminCourtsRepository,
  type AdminCourtDto,
} from './admin-courts.repository.js';
import type {
  CreateCourtBlockDto,
  CreateCourtDto,
  CreateHolidayDto,
  ListBlocksQuery,
  ListCourtsQuery,
  ListHolidaysQuery,
  OpeningHoursDayDto,
  PriceRuleInputDto,
  UpdateCourtDto,
  UpdateOpeningHoursDto,
} from './admin-courts.schemas.js';

const DAY_LABELS: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ nhật',
};

function addCalendarDays(dateStr: string, daysToAdd: number): string {
  const base = toSqlDate(dateStr);
  const shifted = new Date(base.getTime() + daysToAdd * 86_400_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildBlockSlotUpdatedEvents(params: {
  branchId: number;
  courtId: number;
  blockType: BlockType;
  startAt: Date;
  endAt: Date | null;
  now: Date;
  state: 'LOCKED' | 'FREE';
}): DomainEvent[] {
  const events: DomainEvent[] = [];
  const startDate = formatDateVn(params.startAt);
  const startTime = formatTimeVn(params.startAt);

  if (params.blockType === 'DECOMMISSION' || params.endAt === null) {
    events.push({
      rooms: [`availability:${params.branchId}:${startDate}`, `branch:${params.branchId}`],
      event: 'slot.updated',
      payload: {
        branchId: params.branchId,
        courtId: params.courtId,
        date: startDate,
        startTime,
        endTime: '23:59',
        state: params.state,
      },
    });
    const today = formatDateVn(params.now);
    if (today !== startDate && params.startAt.getTime() <= params.now.getTime()) {
      events.push({
        rooms: [`availability:${params.branchId}:${today}`, `branch:${params.branchId}`],
        event: 'slot.updated',
        payload: {
          branchId: params.branchId,
          courtId: params.courtId,
          date: today,
          startTime: '00:00',
          endTime: '23:59',
          state: params.state,
        },
      });
    }
    return events;
  }

  const endDate = formatDateVn(params.endAt);
  const endTime = formatTimeVn(params.endAt);
  let curDate = startDate;
  let guard = 0;

  while (curDate <= endDate && guard < 62) {
    const dayStart = curDate === startDate ? startTime : '00:00';
    const dayEnd = curDate === endDate ? endTime : '23:59';
    if (dayStart < dayEnd) {
      events.push({
        rooms: [`availability:${params.branchId}:${curDate}`, `branch:${params.branchId}`],
        event: 'slot.updated',
        payload: {
          branchId: params.branchId,
          courtId: params.courtId,
          date: curDate,
          startTime: dayStart,
          endTime: dayEnd,
          state: params.state,
        },
      });
    }
    curDate = addCalendarDays(curDate, 1);
    guard += 1;
  }

  return events;
}

@Injectable()
export class AdminCourtsService {
  constructor(
    private readonly repo: AdminCourtsRepository,
    private readonly affectedBookingsService: AffectedBookingsService,
    private readonly auditService: AuditService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private validateDeposit(depositType: DepositType, depositValue: number): void {
    if (depositType === 'PERCENT') {
      if (depositValue < 10 || depositValue > 100) {
        throw new AppError('INVALID_DEPOSIT', 'Tỷ lệ đặt cọc phải nằm trong khoảng 10% – 100%.');
      }
      return;
    }
    if (depositValue <= 0) {
      throw new AppError('INVALID_DEPOSIT', 'Tiền đặt cọc cố định phải lớn hơn 0.');
    }
  }

  private validatePriceRules(rules: PriceRuleInputDto[]): void {
    for (const rule of rules) {
      if (rule.endTime <= rule.startTime) {
        throw new AppError(
          'INVALID_PRICE_RULE',
          `Khung giá ${rule.label}: giờ kết thúc phải sau giờ bắt đầu.`,
        );
      }
      if (rule.pricePerHour <= 0) {
        throw new AppError('INVALID_PRICE_RULE', 'Đơn giá thuê của mỗi khung phải lớn hơn 0.');
      }
    }

    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i];
        const b = rules[j];
        if ((a.dayOfWeekMask & b.dayOfWeekMask) === 0) {
          continue;
        }
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          throw new AppError(
            'PRICE_RULE_OVERLAP',
            'Các khung giá không được chồng chéo thời gian.',
          );
        }
      }
    }
  }

  // API-47
  async listCourts(query: ListCourtsQuery) {
    const exec = await this.txService.executor();
    return this.repo.listCourts(exec, query, this.clock.now());
  }

  // API-48
  async getCourtDetail(courtId: number) {
    const exec = await this.txService.executor();
    const now = this.clock.now();
    const court = await this.repo.getCourtById(exec, courtId, now);
    if (!court) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
    }
    const hasOpenBookings = await this.repo.hasOpenBookings(exec, courtId);
    return {
      ...court,
      hasOpenBookings,
    };
  }

  // API-49, UC 017, R-06
  async createCourt(
    dto: CreateCourtDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<AdminCourtDto> {
    this.validateDeposit(dto.depositType, dto.depositValue);
    this.validatePriceRules(dto.priceRules);

    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const branch = await this.repo.findBranchById(tx, dto.branchId);
      if (!branch) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
      }

      const sport = await this.repo.findSportById(tx, dto.sportId);
      if (!sport) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy bộ môn.');
      }

      const code = await this.repo.generateNextCourtCode(tx, sport.code);
      const courtId = await this.repo.insertCourt(tx, {
        code,
        branchId: dto.branchId,
        sportId: dto.sportId,
        name: dto.name.trim(),
        courtType: dto.courtType?.trim() || null,
        description: dto.description?.trim() || null,
        depositType: dto.depositType,
        depositValue: dto.depositValue,
        status: dto.status,
        now,
      });

      await this.repo.insertPriceRules(tx, courtId, dto.priceRules, now);

      const created = await this.repo.getCourtById(tx, courtId, now);
      if (!created) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'CREATE',
        entityType: 'Courts',
        entityId: courtId,
        oldValue: null,
        newValue: created,
        ipAddress,
      });

      return created;
    });
  }

  // API-50, UC 018, FR 06
  async updateCourt(
    courtId: number,
    dto: UpdateCourtDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    this.validateDeposit(dto.depositType, dto.depositValue);
    this.validatePriceRules(dto.priceRules);

    const now = this.clock.now();

    const updated = await this.txService.withTransaction(async (tx) => {
      const existing = await this.repo.getCourtById(tx, courtId, now);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
      }

      if (dto.sportId !== undefined && dto.sportId !== existing.sport.sportId) {
        throw new AppError('SPORT_IMMUTABLE');
      }

      if (dto.branchId !== existing.branch.branchId) {
        const targetBranch = await this.repo.findBranchById(tx, dto.branchId);
        if (!targetBranch) {
          throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
        }
        const hasOpen = await this.repo.hasOpenBookings(tx, courtId);
        if (hasOpen) {
          throw new AppError('COURT_HAS_OPEN_BOOKINGS');
        }
      }

      await this.repo.updateCourt(tx, {
        courtId,
        branchId: dto.branchId,
        name: dto.name.trim(),
        courtType: dto.courtType?.trim() || null,
        description: dto.description?.trim() || null,
        depositType: dto.depositType,
        depositValue: dto.depositValue,
        status: dto.status,
        now,
      });

      // FR 06: preserve historical CourtPriceRules rows by closing EffectiveTo = now
      await this.repo.closeActivePriceRules(tx, courtId, now);
      await this.repo.insertPriceRules(tx, courtId, dto.priceRules, now);

      const refreshed = await this.repo.getCourtById(tx, courtId, now);
      if (!refreshed) {
        throw new AppError('INTERNAL_ERROR');
      }

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'UPDATE',
        entityType: 'Courts',
        entityId: courtId,
        oldValue: existing,
        newValue: refreshed,
        ipAddress,
      });

      return refreshed;
    });

    let affectedCount = 0;
    if (updated.status === 'INACTIVE') {
      const affected = await this.affectedBookingsService.listAffectedBookings({
        branchId: updated.branch.branchId,
        caller,
        preview: { courtIdFilter: courtId },
      });
      affectedCount = affected.length;
    }

    return {
      court: updated,
      affectedCount,
    };
  }

  // API-51
  async listCourtBlocks(query: ListBlocksQuery) {
    const exec = await this.txService.executor();
    return this.repo.listCourtBlocks(exec, query, this.clock.now());
  }

  // API-52, UC 019
  async createCourtBlock(
    dto: CreateCourtBlockDto,
    dryRun: boolean,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();
    const startAt = fromSqlDateTime(dto.startAt);
    const endAt =
      dto.blockType === 'MAINTENANCE' && dto.endAt ? fromSqlDateTime(dto.endAt) : null;
    const reason = dto.reason.trim();

    if (dryRun) {
      const exec = await this.txService.executor();
      const court = await this.repo.getCourtById(exec, dto.courtId, now);
      if (!court) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
      }

      const affectedBookings = await this.affectedBookingsService.listAffectedBookings({
        branchId: court.branch.branchId,
        caller,
        preview: {
          courtIdFilter: court.courtId,
          block: {
            courtId: court.courtId,
            courtName: court.name,
            blockType: dto.blockType,
            startAt,
            endAt,
            reason,
          },
        },
      });

      return {
        block: null,
        affectedCount: affectedBookings.length,
        affectedBookings,
      };
    }

    const { block, branchId } = await this.txService.withTransaction(async (tx) => {
      const court = await this.repo.getCourtById(tx, dto.courtId, now);
      if (!court) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
      }

      const overlaps = await this.repo.hasOverlappingCourtBlock(
        tx,
        dto.courtId,
        startAt,
        endAt,
      );
      if (overlaps) {
        throw new AppError('BLOCK_OVERLAP');
      }

      const blockId = await this.repo.insertCourtBlock(tx, {
        courtId: dto.courtId,
        blockType: dto.blockType,
        startAt,
        endAt,
        reason,
        createdBy: caller.userId,
        now,
      });

      const createdBlock = {
        blockId,
        courtId: dto.courtId,
        blockType: dto.blockType,
      };

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'CREATE',
        entityType: 'CourtBlocks',
        entityId: blockId,
        oldValue: null,
        newValue: {
          ...createdBlock,
          startAt: toIsoVn(startAt),
          endAt: endAt ? toIsoVn(endAt) : null,
          reason,
        },
        ipAddress,
      });

      tx.events.push(
        ...buildBlockSlotUpdatedEvents({
          branchId: court.branch.branchId,
          courtId: court.courtId,
          blockType: dto.blockType,
          startAt,
          endAt,
          now,
          state: 'LOCKED',
        }),
      );

      return {
        block: createdBlock,
        branchId: court.branch.branchId,
      };
    });

    const affectedBookings = await this.affectedBookingsService.listAffectedBookings({
      branchId,
      caller,
      preview: { courtIdFilter: dto.courtId },
    });

    return {
      block,
      affectedCount: affectedBookings.length,
      affectedBookings,
    };
  }

  // API-53, UC 019
  async releaseCourtBlock(
    blockId: number,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const block = await this.repo.findBlockById(tx, blockId);
      if (!block) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy lịch khóa sân.');
      }
      if (block.releasedAt !== null) {
        throw new AppError('INVALID_STATE_TRANSITION', 'Lịch khóa sân đã được mở lại trước đó.');
      }

      const releasedByName = await this.repo.releaseCourtBlock(tx, blockId, caller.userId, now);

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'RELEASE',
        entityType: 'CourtBlocks',
        entityId: blockId,
        oldValue: { releasedAt: null, releasedBy: null },
        newValue: { releasedAt: toIsoVn(now), releasedBy: caller.userId },
        ipAddress,
      });

      tx.events.push(
        ...buildBlockSlotUpdatedEvents({
          branchId: block.branchId,
          courtId: block.courtId,
          blockType: block.blockType,
          startAt: block.startAt,
          endAt: block.endAt,
          now,
          state: 'FREE',
        }),
      );

      return {
        blockId,
        releasedAt: toIsoVn(now),
        releasedByName,
      };
    });
  }

  // API-54
  async getOpeningHours(branchId: number) {
    const exec = await this.txService.executor();
    const branch = await this.repo.findBranchById(exec, branchId);
    if (!branch) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
    }
    const days = await this.repo.getOpeningHours(exec, branchId);
    return {
      branchId,
      days,
    };
  }

  // API-55, UC 020
  async updateOpeningHours(
    branchId: number,
    dto: UpdateOpeningHoursDto,
    dryRun: boolean,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const exec = await this.txService.executor();
    const branch = await this.repo.findBranchById(exec, branchId);
    if (!branch) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
    }

    const seenDays = new Set<number>();
    const normalizedDays: OpeningHoursDayDto[] = [];
    for (const day of dto.days) {
      if (seenDays.has(day.dayOfWeek)) {
        throw new AppError('VALIDATION_ERROR', 'Danh sách ngày trong tuần không được trùng lặp.');
      }
      seenDays.add(day.dayOfWeek);

      if (!day.isClosed) {
        if (!day.openTime || !day.closeTime || day.openTime >= day.closeTime) {
          const dayLabel = DAY_LABELS[day.dayOfWeek] ?? `Thứ ${day.dayOfWeek}`;
          throw new AppError(
            'INVALID_OPENING_HOURS',
            `${branch.name} – ${dayLabel}: Giờ đóng cửa phải lớn hơn giờ mở cửa.`,
          );
        }
        normalizedDays.push({
          dayOfWeek: day.dayOfWeek,
          openTime: day.openTime,
          closeTime: day.closeTime,
          isClosed: false,
        });
      } else {
        normalizedDays.push({
          dayOfWeek: day.dayOfWeek,
          openTime: null,
          closeTime: null,
          isClosed: true,
        });
      }
    }
    normalizedDays.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

    if (dryRun) {
      const affectedBookings = await this.affectedBookingsService.listAffectedBookings({
        branchId,
        caller,
        preview: {
          branchIdFilter: branchId,
          openingHours: {
            branchId,
            days: normalizedDays,
          },
        },
      });
      return {
        branchId,
        days: normalizedDays,
        affectedCount: affectedBookings.length,
        affectedBookings,
      };
    }

    await this.txService.withTransaction(async (tx) => {
      const existingDays = await this.repo.getOpeningHours(tx, branchId);
      await this.repo.replaceOpeningHours(tx, branchId, normalizedDays);
      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'UPDATE',
        entityType: 'BranchOpeningHours',
        entityId: branchId,
        oldValue: existingDays,
        newValue: normalizedDays,
        ipAddress,
      });
    });

    const affectedBookings = await this.affectedBookingsService.listAffectedBookings({
      branchId,
      caller,
    });

    return {
      branchId,
      days: normalizedDays,
      affectedCount: affectedBookings.length,
      affectedBookings,
    };
  }

  // API-56
  async listHolidays(query: ListHolidaysQuery) {
    const exec = await this.txService.executor();
    const from = query.from ?? formatDateVn(this.clock.now());
    return this.repo.listHolidays(exec, {
      branchId: query.branchId,
      from,
    });
  }

  // API-57, UC 020, Q-06
  async createHolidays(
    dto: CreateHolidayDto,
    dryRun: boolean,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();
    const today = formatDateVn(now);
    if (dto.startDate < today) {
      throw new AppError('HOLIDAY_IN_PAST', 'Không thể thêm ngày nghỉ trong quá khứ.');
    }

    const endDate = addCalendarDays(dto.startDate, dto.days - 1);
    const reason = dto.reason && dto.reason.trim().length > 0 ? dto.reason.trim() : 'Nghỉ lễ';

    const exec = await this.txService.executor();
    let targetBranchIds: number[] = [];

    if (dto.scope === 'BRANCH') {
      if (!dto.branchId) {
        throw new AppError('VALIDATION_ERROR', 'Vui lòng chọn chi nhánh áp dụng ngày nghỉ.');
      }
      const branch = await this.repo.findBranchById(exec, dto.branchId);
      if (!branch) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
      }
      targetBranchIds = [branch.branchId];
    } else {
      const branches = await this.repo.findActiveBranches(exec);
      targetBranchIds = branches.map((b) => b.branchId);
    }

    if (dryRun) {
      const branchFilter = dto.scope === 'BRANCH' ? dto.branchId! : null;
      const affectedBookings = await this.affectedBookingsService.listAffectedBookings({
        branchId: branchFilter,
        caller,
        preview: {
          branchIdFilter: branchFilter,
          holiday: {
            branchIds: targetBranchIds,
            startDate: dto.startDate,
            endDate,
            reason,
          },
        },
      });
      return {
        holidays: [],
        affectedCount: affectedBookings.length,
        affectedBookings,
      };
    }

    const holidays = await this.txService.withTransaction(async (tx) => {
      const groupKey =
        dto.scope === 'ALL' ? await this.repo.generateNextHolidayGroupKey(tx, dto.startDate) : null;

      const inserted = await this.repo.insertHolidays(tx, {
        branchIds: targetBranchIds,
        startDate: dto.startDate,
        endDate,
        reason,
        groupKey,
        createdBy: caller.userId,
        now,
      });

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'CREATE',
        entityType: 'BranchHolidays',
        entityId: groupKey ?? String(inserted[0]?.holidayId ?? 0),
        oldValue: null,
        newValue: {
          startDate: dto.startDate,
          endDate,
          scope: dto.scope,
          groupKey,
          reason,
          holidays: inserted,
        },
        ipAddress,
      });

      return inserted;
    });

    const affectedBookings = await this.affectedBookingsService.listAffectedBookings({
      branchId: dto.scope === 'BRANCH' ? dto.branchId! : null,
      caller,
    });

    return {
      holidays,
      affectedCount: affectedBookings.length,
      affectedBookings,
    };
  }

  // API-58, UC 020
  async deleteHoliday(
    holidayId: number,
    group: boolean,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ): Promise<void> {
    await this.txService.withTransaction(async (tx) => {
      const holiday = await this.repo.findHolidayById(tx, holidayId);
      if (!holiday) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy ngày nghỉ.');
      }

      if (group && holiday.groupKey) {
        const oldRows = await this.repo.findHolidaysByGroupKey(tx, holiday.groupKey);
        await this.repo.deleteHolidaysByGroupKey(tx, holiday.groupKey);
        await this.auditService.writeInTx(tx, {
          userId: caller.userId,
          action: 'DELETE',
          entityType: 'BranchHolidays',
          entityId: holiday.groupKey,
          oldValue: oldRows,
          newValue: null,
          ipAddress,
        });
      } else {
        await this.repo.deleteHolidayById(tx, holidayId);
        await this.auditService.writeInTx(tx, {
          userId: caller.userId,
          action: 'DELETE',
          entityType: 'BranchHolidays',
          entityId: holidayId,
          oldValue: holiday,
          newValue: null,
          ipAddress,
        });
      }
    });
  }
}
