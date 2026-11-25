import { Injectable } from '@nestjs/common';
import type { BookingSummaryDto, ReceiptDto } from '@sporthub/shared/types';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { PosBookingService } from './pos-booking.service.js';
import { PosLifecycleService } from './pos-lifecycle.service.js';
import type { PosCustomerRecord } from './pos.repository.js';
import {
  type PosPromotionItemDto,
  type PosScheduleResult,
  PosScheduleService,
} from './pos-schedule.service.js';
import type {
  CreatePosBookingDto,
  PosAbortDto,
  PosBookingsListQuery,
  PosBookingTab,
  PosCashPaymentDto,
  PosCheckInDto,
  PosCompleteDto,
  PosPromotionsQuery,
  PosScheduleQuery,
  PosSettleDto,
} from './pos.schemas.js';

export type {
  PosPromotionItemDto,
  PosScheduleCell,
  PosScheduleResult,
  PosScheduleSlotHeader,
} from './pos-schedule.service.js';

@Injectable()
export class PosService {
  constructor(
    private readonly scheduleService: PosScheduleService,
    private readonly bookingService: PosBookingService,
    private readonly lifecycleService: PosLifecycleService,
  ) {}

  getSchedule(branchId: number, query: PosScheduleQuery): Promise<PosScheduleResult> {
    return this.scheduleService.getSchedule(branchId, query);
  }

  lookupCustomerByPhone(phone: string): Promise<{
    found: boolean;
    customer: PosCustomerRecord | null;
  }> {
    return this.scheduleService.lookupCustomerByPhone(phone);
  }

  listPromotions(
    branchId: number,
    query: PosPromotionsQuery,
  ): Promise<{ defaultCode: string | null; items: PosPromotionItemDto[] }> {
    return this.scheduleService.listPromotions(branchId, query);
  }

  createPosBooking(
    dto: CreatePosBookingDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto; receipt: ReceiptDto | null }> {
    return this.bookingService.createPosBooking(dto, caller);
  }

  collectCashPayment(
    bookingCode: string,
    dto: PosCashPaymentDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto; receipt: ReceiptDto }> {
    return this.bookingService.collectCashPayment(bookingCode, dto, caller);
  }

  abortCounterBooking(
    bookingCode: string,
    dto: PosAbortDto,
    caller: AuthenticatedUser,
  ): Promise<{ bookingCode: string; status: 'CANCELED'; cancelType: 'COUNTER_ABORT' }> {
    return this.bookingService.abortCounterBooking(bookingCode, dto, caller);
  }

  getLatestReceipt(branchId: number): Promise<ReceiptDto | null> {
    return this.scheduleService.getLatestReceipt(branchId);
  }

  listBranchBookings(
    branchId: number,
    query: PosBookingsListQuery,
    caller: AuthenticatedUser,
  ): Promise<{
    items: BookingSummaryDto[];
    totalItems: number;
    tabCounts: Record<PosBookingTab | 'AFFECTED', number>;
  }> {
    return this.scheduleService.listBranchBookings(branchId, query, caller);
  }

  settleBooking(
    bookingCode: string,
    dto: PosSettleDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto; receipt: ReceiptDto }> {
    return this.lifecycleService.settleBooking(bookingCode, dto, caller);
  }

  checkInBooking(
    bookingCode: string,
    dto: PosCheckInDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto }> {
    return this.lifecycleService.checkInBooking(bookingCode, dto, caller);
  }

  completeBooking(
    bookingCode: string,
    dto: PosCompleteDto,
    caller: AuthenticatedUser,
  ): Promise<{ booking: BookingSummaryDto }> {
    return this.lifecycleService.completeBooking(bookingCode, dto, caller);
  }
}
