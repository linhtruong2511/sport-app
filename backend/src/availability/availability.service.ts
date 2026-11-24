import { Inject, Injectable } from '@nestjs/common';
import type { BlockType } from '@sporthub/shared/enums';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import {
  addDays,
  dayOfWeekBit,
  minutesToTime,
  parseTimeToMinutes,
  parseVnDateTime,
  vnDayOfWeek,
} from '../core/time.js';
import { calculateRentalPrice, type PriceRuleInput } from '../pricing/pricing.engine.js';
import {
  type ActiveBookedSlotRecord,
  AvailabilityRepository,
  type CourtBlockRecord,
  type CourtPriceRuleRecord,
  type HolidayRecord,
} from './availability.repository.js';

export interface AvailabilitySlotHeader {
  start: string;
  end: string;
  priceLabel: string | null;
}

export type AvailabilityCell =
  | { start: string; end: string; state: 'FREE'; price?: number }
  | { start: string; end: string; state: 'PAST' }
  | { start: string; end: string; state: 'BOOKED'; label: string }
  | { start: string; end: string; state: 'HELD'; label: string }
  | { start: string; end: string; state: 'MINE'; label: string }
  | {
      start: string;
      end: string;
      state: 'LOCKED';
      blockId: number;
      blockType: BlockType;
      reason: string;
    };

export type CourtDisplayState = 'READY' | 'MAINTENANCE' | 'DECOMMISSION';

export interface AvailabilityCourtRow {
  courtId: number;
  code: string;
  name: string;
  state: CourtDisplayState;
  cells: AvailabilityCell[];
}

export interface AvailabilityResult {
  date: string;
  dayOfWeek: number;
  branch: {
    branchId: number;
    name: string;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  };
  holiday: HolidayRecord | null;
  slotMinutes: number;
  slots: AvailabilitySlotHeader[];
  priceHint: string;
  courts: AvailabilityCourtRow[];
}

export interface BranchAvailabilitySummary {
  branch: {
    branchId: number;
    name: string;
    address: string;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
    holiday: HolidayRecord | null;
  };
  freeSlotCountBySportId: Map<number, number>;
}

function formatHourCompact(hhmm: string): string {
  const [hh, mm] = hhmm.split(':');
  return mm === '00' ? `${hh}h` : `${hh}h${mm}`;
}

function formatPriceCompact(pricePerHour: number): string {
  if (pricePerHour % 1000 === 0) {
    return `${pricePerHour / 1000}k/h`;
  }
  return `${pricePerHour}đ/h`;
}

function buildTimeSlots(
  openTime: string | null,
  closeTime: string | null,
  isClosed: boolean,
  hasHoliday: boolean,
  slotMinutes: number,
): Array<{ start: string; end: string }> {
  if (isClosed || hasHoliday || !openTime || !closeTime || slotMinutes <= 0) {
    return [];
  }
  const openMin = parseTimeToMinutes(openTime);
  const closeMin = parseTimeToMinutes(closeTime);
  const slots: Array<{ start: string; end: string }> = [];
  for (let cur = openMin; cur + slotMinutes <= closeMin; cur += slotMinutes) {
    slots.push({
      start: minutesToTime(cur),
      end: minutesToTime(cur + slotMinutes),
    });
  }
  return slots;
}

function getSlotPriceLabel(
  slotStart: string,
  slotEnd: string,
  dowBit: number,
  rules: CourtPriceRuleRecord[],
): string | null {
  const sMin = parseTimeToMinutes(slotStart);
  const eMin = parseTimeToMinutes(slotEnd);
  const labels: string[] = [];

  for (const r of rules) {
    if ((r.dayOfWeekMask & dowBit) === 0) continue;
    const rStart = parseTimeToMinutes(r.startTime);
    const rEnd = parseTimeToMinutes(r.endTime);
    if (rStart < eMin && rEnd > sMin && !labels.includes(r.label)) {
      labels.push(r.label);
    }
  }

  return labels.length > 0 ? labels.join(' / ') : null;
}

function buildPriceHint(rules: CourtPriceRuleRecord[], dowBit: number): string {
  const matching = rules.filter((r) => (r.dayOfWeekMask & dowBit) !== 0);
  const source = matching.length > 0 ? matching : rules;
  const seen = new Set<string>();
  const parts: Array<{ startTime: string; text: string }> = [];

  for (const r of source) {
    const key = `${r.label}|${r.startTime}|${r.endTime}|${r.pricePerHour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push({
      startTime: r.startTime,
      text: `${r.label} ${formatHourCompact(r.startTime)}–${formatHourCompact(r.endTime)}: ${formatPriceCompact(r.pricePerHour)}`,
    });
  }

  parts.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return parts.map((p) => p.text).join(' • ');
}

function resolveCourtState(blocks: CourtBlockRecord[]): CourtDisplayState {
  if (blocks.some((b) => b.blockType === 'DECOMMISSION')) {
    return 'DECOMMISSION';
  }
  if (blocks.some((b) => b.blockType === 'MAINTENANCE')) {
    return 'MAINTENANCE';
  }
  return 'READY';
}

function computeCellPrice(
  date: string,
  startTime: string,
  endTime: string,
  now: Date,
  rules: PriceRuleInput[],
): number | null {
  try {
    const { baseAmount } = calculateRentalPrice({
      date,
      startTime,
      endTime,
      now,
      rules,
    });
    return baseAmount;
  } catch {
    return null;
  }
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly txService: DbTransactionService,
    private readonly repo: AvailabilityRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getAvailability(params: {
    branchId: number;
    sportId: number;
    date: string;
    callerUserId?: number;
  }): Promise<AvailabilityResult> {
    const { branchId, sportId, date, callerUserId } = params;
    const now = this.clock.now();
    const dayOfWeek = vnDayOfWeek(date);
    const dowBit = dayOfWeekBit(dayOfWeek);
    const dayStart = parseVnDateTime(date, '00:00');
    const dayEnd = addDays(dayStart, 1);

    const exec = await this.txService.executor();
    const [branch, openingHours, holiday, sport] = await Promise.all([
      this.repo.findActiveBranch(exec, branchId),
      this.repo.findOpeningHoursForDay(exec, branchId, dayOfWeek),
      this.repo.findHolidayForDate(exec, branchId, date),
      this.repo.findSport(exec, sportId),
    ]);

    if (!branch) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
    }
    if (!sport) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy bộ môn.');
    }

    const isClosed = openingHours ? openingHours.isClosed : true;
    const openTime = isClosed ? null : (openingHours?.openTime ?? null);
    const closeTime = isClosed ? null : (openingHours?.closeTime ?? null);

    const courts = await this.repo.findActiveCourts(exec, branchId, sportId);
    const courtIds = courts.map((c) => c.courtId);

    const [priceRules, blocks, bookedSlots] = await Promise.all([
      this.repo.findActivePriceRulesForCourts(exec, courtIds, now),
      this.repo.findUnreleasedBlocksForCourts(exec, courtIds, dayStart, dayEnd),
      this.repo.findActiveBookedSlotsForCourts(exec, courtIds, dayStart, dayEnd),
    ]);

    const rawSlots = buildTimeSlots(
      openTime,
      closeTime,
      isClosed,
      holiday !== null,
      sport.displayBlockMinutes,
    );

    const firstCourtRules =
      courtIds.length > 0 ? priceRules.filter((r) => r.courtId === courtIds[0]) : [];
    const headerRules = firstCourtRules.length > 0 ? firstCourtRules : priceRules;

    const slots: AvailabilitySlotHeader[] = rawSlots.map((s) => ({
      start: s.start,
      end: s.end,
      priceLabel: getSlotPriceLabel(s.start, s.end, dowBit, headerRules),
    }));

    const priceHint = buildPriceHint(headerRules, dowBit);

    const rulesByCourt = this.groupByCourt(priceRules);
    const blocksByCourt = this.groupByCourt(blocks);
    const bookingsByCourt = this.groupByCourt(bookedSlots);

    const courtRows: AvailabilityCourtRow[] = courts.map((court) => {
      const courtBlocks = blocksByCourt.get(court.courtId) ?? [];
      const courtRules = rulesByCourt.get(court.courtId) ?? [];
      const courtBookings = bookingsByCourt.get(court.courtId) ?? [];

      const cells: AvailabilityCell[] = rawSlots.map((s) =>
        this.resolveCell({
          date,
          start: s.start,
          end: s.end,
          now,
          callerUserId,
          courtBlocks,
          courtBookings,
          courtRules,
          includePrice: true,
        }),
      );

      return {
        courtId: court.courtId,
        code: court.code,
        name: court.name,
        state: resolveCourtState(courtBlocks),
        cells,
      };
    });

    return {
      date,
      dayOfWeek,
      branch: {
        branchId: branch.branchId,
        name: branch.name,
        openTime,
        closeTime,
        isClosed,
      },
      holiday,
      slotMinutes: sport.displayBlockMinutes,
      slots,
      priceHint,
      courts: courtRows,
    };
  }

  /**
   * Shared summary helper for `catalog` API-08 so freeSlotCount uses the exact same
   * opening hours, holiday, block, booking, and past-slot algorithm as API-11.
   */
  async getBranchAvailabilitySummary(
    branchId: number,
    date: string,
  ): Promise<BranchAvailabilitySummary> {
    const now = this.clock.now();
    const dayOfWeek = vnDayOfWeek(date);
    const dayStart = parseVnDateTime(date, '00:00');
    const dayEnd = addDays(dayStart, 1);

    const exec = await this.txService.executor();
    const [branch, openingHours, holiday, sports, courts] = await Promise.all([
      this.repo.findActiveBranch(exec, branchId),
      this.repo.findOpeningHoursForDay(exec, branchId, dayOfWeek),
      this.repo.findHolidayForDate(exec, branchId, date),
      this.repo.findSportsByBranchActiveCourts(exec, branchId),
      this.repo.findActiveCourts(exec, branchId),
    ]);

    if (!branch) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy chi nhánh.');
    }

    const isClosed = openingHours ? openingHours.isClosed : true;
    const openTime = isClosed ? null : (openingHours?.openTime ?? null);
    const closeTime = isClosed ? null : (openingHours?.closeTime ?? null);

    const freeSlotCountBySportId = new Map<number, number>();
    for (const s of sports) {
      freeSlotCountBySportId.set(s.sportId, 0);
    }

    if (!isClosed && holiday === null && openTime && closeTime && courts.length > 0) {
      const courtIds = courts.map((c) => c.courtId);
      const [blocks, bookedSlots] = await Promise.all([
        this.repo.findUnreleasedBlocksForCourts(exec, courtIds, dayStart, dayEnd),
        this.repo.findActiveBookedSlotsForCourts(exec, courtIds, dayStart, dayEnd),
      ]);

      const blocksByCourt = this.groupByCourt(blocks);
      const bookingsByCourt = this.groupByCourt(bookedSlots);

      for (const sport of sports) {
        const rawSlots = buildTimeSlots(
          openTime,
          closeTime,
          isClosed,
          false,
          sport.displayBlockMinutes,
        );
        if (rawSlots.length === 0) continue;

        const sportCourts = courts.filter((c) => c.sportId === sport.sportId);
        let freeCount = 0;

        for (const court of sportCourts) {
          const courtBlocks = blocksByCourt.get(court.courtId) ?? [];
          const courtBookings = bookingsByCourt.get(court.courtId) ?? [];

          for (const s of rawSlots) {
            const cell = this.resolveCell({
              date,
              start: s.start,
              end: s.end,
              now,
              courtBlocks,
              courtBookings,
              courtRules: [],
              includePrice: false,
            });
            if (cell.state === 'FREE') {
              freeCount += 1;
            }
          }
        }

        freeSlotCountBySportId.set(sport.sportId, freeCount);
      }
    }

    return {
      branch: {
        branchId: branch.branchId,
        name: branch.name,
        address: branch.address,
        openTime,
        closeTime,
        isClosed,
        holiday,
      },
      freeSlotCountBySportId,
    };
  }

  private resolveCell(params: {
    date: string;
    start: string;
    end: string;
    now: Date;
    callerUserId?: number;
    courtBlocks: CourtBlockRecord[];
    courtBookings: ActiveBookedSlotRecord[];
    courtRules: CourtPriceRuleRecord[];
    includePrice: boolean;
  }): AvailabilityCell {
    const {
      date,
      start,
      end,
      now,
      callerUserId,
      courtBlocks,
      courtBookings,
      courtRules,
      includePrice,
    } = params;

    const slotStartAt = parseVnDateTime(date, start);
    const slotEndAt = parseVnDateTime(date, end);

    // 1. LOCKED if any unreleased CourtBlock overlaps [slotStartAt, slotEndAt)
    const overlappingBlock = courtBlocks.find(
      (b) => b.startAt < slotEndAt && (b.endAt === null || b.endAt > slotStartAt),
    );
    if (overlappingBlock) {
      return {
        start,
        end,
        state: 'LOCKED',
        blockId: overlappingBlock.blockId,
        blockType: overlappingBlock.blockType,
        reason: overlappingBlock.reason,
      };
    }

    // 2. Active BookingSlots overlapping [slotStartAt, slotEndAt): MINE -> HELD -> BOOKED
    const overlappingBookings = courtBookings.filter(
      (bs) => bs.slotStart >= slotStartAt && bs.slotStart < slotEndAt,
    );
    if (overlappingBookings.length > 0) {
      if (
        callerUserId !== undefined &&
        overlappingBookings.some((bs) => bs.customerUserId === callerUserId)
      ) {
        return { start, end, state: 'MINE', label: 'Lịch của bạn' };
      }
      if (overlappingBookings.some((bs) => bs.status === 'PENDING_PAYMENT')) {
        return { start, end, state: 'HELD', label: 'Đang giữ chỗ' };
      }
      return { start, end, state: 'BOOKED', label: 'Kín lịch' };
    }

    // 3. PAST if slotStartAt <= now
    if (slotStartAt.getTime() <= now.getTime()) {
      return { start, end, state: 'PAST' };
    }

    // 4. FREE
    const price = includePrice ? computeCellPrice(date, start, end, now, courtRules) : null;
    if (price !== null) {
      return { start, end, state: 'FREE', price };
    }
    return { start, end, state: 'FREE' };
  }

  private groupByCourt<T extends { courtId: number }>(items: T[]): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const item of items) {
      const list = map.get(item.courtId);
      if (list) {
        list.push(item);
      } else {
        map.set(item.courtId, [item]);
      }
    }
    return map;
  }
}
