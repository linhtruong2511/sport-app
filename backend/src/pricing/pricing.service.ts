import { Inject, Injectable } from '@nestjs/common';
import type { DepositType, PaymentOption, PromoReasonCode } from '@sporthub/shared/enums';
import type { BookingPriceLineDto } from '@sporthub/shared/types';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { parseTimeToMinutes, parseVnDateTime, vnDayOfWeek } from '../core/time.js';
import {
  calculateQuoteAmounts,
  calculateRentalPrice,
  evaluatePromotion,
} from './pricing.engine.js';
import { PricingRepository } from './pricing.repository.js';
import type { QuoteRequestDto } from './pricing.schemas.js';

export interface QuotePromotionDto {
  code: string;
  applied: boolean;
  reasonCode: PromoReasonCode | null;
  discountAmount: number;
  message: string;
}

export interface QuoteResponseDto {
  court: {
    courtId: number;
    name: string;
    branchName: string;
  };
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  slotAvailable: boolean;
  priceLines: BookingPriceLineDto[];
  baseAmount: number;
  promotion: QuotePromotionDto | null;
  discountAmount: number;
  totalAmount: number;
  deposit: {
    type: DepositType;
    value: number;
    amount: number;
    fullPaymentRequired: boolean;
  };
  paymentOption: PaymentOption;
  amountDueNow: number;
  remainingOnArrival: number;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly pricingRepository: PricingRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async quote(dto: QuoteRequestDto, caller?: AuthenticatedUser): Promise<QuoteResponseDto> {
    if (dto.channel === 'COUNTER' && caller?.role !== 'STAFF' && caller?.role !== 'OWNER') {
      throw new AppError('FORBIDDEN');
    }

    const court = await this.pricingRepository.findCourtContext(dto.courtId);
    if (!court) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy sân yêu cầu.');
    }

    // Check branch active, not on holiday, and open on that day of week.
    const dayOfWeek = vnDayOfWeek(dto.date);
    const [hasHoliday, openingHour] = await Promise.all([
      this.pricingRepository.hasBranchHoliday(court.branchId, dto.date),
      this.pricingRepository.findBranchOpeningHour(court.branchId, dayOfWeek),
    ]);

    if (
      court.branchStatus !== 'ACTIVE' ||
      hasHoliday ||
      !openingHour ||
      openingHour.isClosed ||
      !openingHour.openTime ||
      !openingHour.closeTime
    ) {
      throw new AppError('BRANCH_CLOSED');
    }

    const startMin = parseTimeToMinutes(dto.startTime);
    const endMin = parseTimeToMinutes(dto.endTime);
    const openMin = parseTimeToMinutes(openingHour.openTime);
    const closeMin = parseTimeToMinutes(openingHour.closeTime);
    if (startMin < openMin || endMin > closeMin) {
      throw new AppError('OUTSIDE_OPENING_HOURS');
    }

    const durationMinutes = endMin - startMin;
    if (startMin % court.gridBlockMinutes !== 0 || durationMinutes % court.gridBlockMinutes !== 0) {
      throw new AppError('INVALID_TIME_STEP');
    }

    const now = this.clock.now();
    const rules = await this.pricingRepository.findActivePriceRules(court.courtId, now);
    const rental = calculateRentalPrice({
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      now,
      rules,
    });

    const startAt = parseVnDateTime(dto.date, dto.startTime);
    const endAt = parseVnDateTime(dto.date, dto.endTime);

    const [hasBlock, hasSlot] = await Promise.all([
      this.pricingRepository.hasOverlappingCourtBlock(court.courtId, startAt, endAt),
      this.pricingRepository.hasOverlappingBookingSlot(court.courtId, startAt, endAt),
    ]);

    const slotAvailable =
      court.courtStatus === 'ACTIVE' &&
      startAt.getTime() > now.getTime() &&
      !hasBlock &&
      !hasSlot;

    const promoCode = dto.promotionCode && dto.promotionCode.length > 0 ? dto.promotionCode : undefined;

    let promotion: QuotePromotionDto | null = null;
    let discountAmount = 0;

    if (promoCode) {
      let customerUserId: number | null = null;
      if (dto.channel === 'COUNTER') {
        customerUserId = dto.customerPhone
          ? await this.pricingRepository.findCustomerIdByPhone(dto.customerPhone)
          : null;
      } else {
        customerUserId = caller?.role === 'CUSTOMER' ? caller.userId : null;
      }

      const isGuest = customerUserId === null;
      const promoRecord = await this.pricingRepository.findPromotionForQuote(
        promoCode,
        court.branchId,
        court.sportId,
        customerUserId,
      );

      const evalResult = evaluatePromotion({
        code: promoCode,
        promo: promoRecord
          ? {
              promotionId: promoRecord.promotionId,
              code: promoRecord.code,
              name: promoRecord.name,
              status: promoRecord.status,
              discountType: promoRecord.discountType,
              discountValue: promoRecord.discountValue,
              maxDiscountAmount: promoRecord.maxDiscountAmount,
              startDate: promoRecord.startDate,
              endDate: promoRecord.endDate,
              timeFrom: promoRecord.timeFrom,
              timeTo: promoRecord.timeTo,
              allBranches: promoRecord.allBranches,
              allSports: promoRecord.allSports,
              audienceType: promoRecord.audienceType,
              maxUses: promoRecord.maxUses,
              usedCount: promoRecord.usedCount,
            }
          : null,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        baseAmount: rental.baseAmount,
        isGuest,
        isBranchEligible: promoRecord?.isBranchEligible ?? false,
        isSportEligible: promoRecord?.isSportEligible ?? false,
        isCustomerEligible: promoRecord?.isCustomerEligible ?? false,
      });

      promotion = {
        code: promoCode,
        applied: evalResult.applied,
        reasonCode: evalResult.reasonCode,
        discountAmount: evalResult.discountAmount,
        message: evalResult.message,
      };
      discountAmount = evalResult.discountAmount;
    }

    const amounts = calculateQuoteAmounts({
      baseAmount: rental.baseAmount,
      discountAmount,
      paymentOption: dto.paymentOption,
      depositType: court.depositType,
      depositValue: court.depositValue,
    });

    return {
      court: {
        courtId: court.courtId,
        name: court.courtName,
        branchName: court.branchName,
      },
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      durationMinutes,
      slotAvailable,
      priceLines: rental.priceLines.map((line) => ({
        label: line.label,
        startTime: line.startTime,
        endTime: line.endTime,
        pricePerHour: line.pricePerHour,
        amount: line.amount,
      })),
      baseAmount: rental.baseAmount,
      promotion,
      discountAmount,
      totalAmount: amounts.totalAmount,
      deposit: {
        type: court.depositType,
        value: court.depositValue,
        amount: amounts.depositAmount,
        fullPaymentRequired: amounts.fullPaymentRequired,
      },
      paymentOption: amounts.fullPaymentRequired ? 'FULL' : dto.paymentOption,
      amountDueNow: amounts.amountDueNow,
      remainingOnArrival: amounts.remainingOnArrival,
    };
  }
}
