import { useQuery } from '@tanstack/react-query';
import type {
  ApiListSuccess,
  ApiSuccess,
  BlockType,
  BookingStatus,
  BookingSummaryDto,
  CancelType,
  PaymentMethod,
  PaymentOption,
  PaymentStatus,
  PromoReasonCode,
  ReceiptDto,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export type PosScheduleCellState =
  | 'FREE'
  | 'PENDING_PAYMENT'
  | 'BOOKED'
  | 'IN_USE'
  | 'LOCKED'
  | 'PAST';

export interface PosScheduleCellBooking {
  bookingCode: string;
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  paidAmount?: number;
  totalAmount?: number;
  remainingAmount?: number;
  customerName?: string;
  customerPhone?: string;
  isGuest?: boolean;
  isOverdue?: boolean;
}

export interface PosScheduleCell {
  start: string;
  end: string;
  state: PosScheduleCellState;
  price?: number;
  label?: string;
  blockId?: number;
  blockType?: BlockType;
  reason?: string;
  booking?: PosScheduleCellBooking | null;
}

export interface PosScheduleCourt {
  courtId: number;
  code: string;
  name: string;
  sportId?: number;
  sportCode?: string;
  sportName?: string;
  minPricePerHour?: number | null;
  maxPricePerHour?: number | null;
  cells: PosScheduleCell[];
}

export interface PosScheduleSlot {
  start: string;
  end: string;
  priceLabel: string | null;
  isPeak?: boolean;
}

export interface PosScheduleBranchInfo {
  branchId: number;
  name: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed?: boolean;
}

export interface PosScheduleHolidayInfo {
  holidayId?: number;
  startDate?: string;
  endDate?: string;
  reason?: string | null;
  name?: string;
  date?: string;
  note?: string | null;
}

export interface PosScheduleResponse {
  date: string;
  branch: PosScheduleBranchInfo;
  holiday: PosScheduleHolidayInfo | null;
  slotMinutes: number;
  slots: PosScheduleSlot[];
  courts: PosScheduleCourt[];
}

export interface GetPosScheduleParams {
  branchId: number;
  date: string;
  sportId?: number;
}

export interface PosCustomerDto {
  userId: number;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  memberTier: string | null;
}

export interface LookupPosCustomerResponse {
  found: boolean;
  customer: PosCustomerDto | null;
}

export interface GetPosPromotionsParams {
  branchId: number;
  courtId?: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  customerPhone?: string;
}

export interface PosPromotionItem {
  code: string;
  name: string;
  applicable: boolean;
  discountAmount: number;
  reasonCode: PromoReasonCode | null;
  message: string | null;
}

export interface PosPromotionsResponse {
  defaultCode: string | null;
  items: PosPromotionItem[];
}

export type PosCustomerType = 'GUEST' | 'MEMBER';

export interface PosBookingCustomerInput {
  type: PosCustomerType;
  userId?: number | null;
  phone: string;
  fullName: string;
}

export interface PosBookingCashPaymentInput {
  method: Extract<PaymentMethod, 'CASH'>;
  amount: number;
}

export interface CreatePosBookingInput {
  branchId: number;
  courtId: number;
  date: string;
  startTime: string;
  endTime: string;
  customer: PosBookingCustomerInput;
  promotionCode?: string | null;
  paymentOption: PaymentOption;
  payment?: PosBookingCashPaymentInput | null;
  note?: string | null;
}

export interface PosBookingWithOptionalReceiptResponse {
  booking: BookingSummaryDto;
  receipt: ReceiptDto | null;
}

export interface CollectPosCashInput {
  method: Extract<PaymentMethod, 'CASH'>;
  amount: number;
  version: string;
}

export interface PosBookingWithReceiptResponse {
  booking: BookingSummaryDto;
  receipt: ReceiptDto;
}

export interface AbortPosBookingInput {
  reason?: string | null;
  version: string;
}

export interface AbortPosBookingResponse {
  bookingCode: string;
  status: Extract<BookingStatus, 'CANCELED'>;
  cancelType: Extract<CancelType, 'COUNTER_ABORT'>;
}

export type PosBookingsTab =
  | 'ALL'
  | 'WAITING'
  | 'IN_USE'
  | 'OVERDUE'
  | 'PENDING_PAYMENT'
  | 'COMPLETED'
  | 'CANCELED'
  | 'EXPIRED';

export interface GetPosBookingsParams {
  branchId: number;
  date: string;
  tab?: PosBookingsTab;
  q?: string;
  page?: number;
  pageSize?: number;
}

export type PosBookingsListResponse = ApiListSuccess<BookingSummaryDto> & {
  meta: {
    tabCounts: Record<PosBookingsTab | 'AFFECTED', number>;
  };
};

export interface SettlePosBookingInput {
  method: Extract<PaymentMethod, 'CASH'>;
  amount: number;
  checkIn?: boolean;
  version: string;
}

export interface CheckInPosBookingInput {
  version: string;
}

export interface CompletePosBookingInput {
  note?: string | null;
  version: string;
}

export interface PosBookingTransitionResponse {
  booking: BookingSummaryDto;
}

export const posKeys = {
  all: ['pos'] as const,
  schedule: (params: Partial<GetPosScheduleParams>) =>
    ['pos', 'schedule', params.branchId ?? null, params.date ?? null, params.sportId ?? null] as const,
  promotions: (params?: Partial<GetPosPromotionsParams> | null) =>
    ['pos', 'promotions', params ?? {}] as const,
  latestReceipt: (branchId: number | null | undefined) =>
    ['pos', 'latest-receipt', branchId ?? null] as const,
  bookings: (params?: Partial<GetPosBookingsParams> | null) =>
    ['pos', 'bookings', params ?? {}] as const,
};

// API-25
export async function getPosScheduleApi(
  params: GetPosScheduleParams,
): Promise<PosScheduleResponse> {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
    date: params.date,
  });
  if (typeof params.sportId === 'number') {
    search.set('sportId', String(params.sportId));
  }
  const res = await apiFetch<ApiSuccess<PosScheduleResponse>>(`/pos/schedule?${search.toString()}`);
  return res.data;
}

// API-26
export async function lookupPosCustomerApi(phone: string): Promise<LookupPosCustomerResponse> {
  const search = new URLSearchParams({ phone: phone.trim() });
  const res = await apiFetch<ApiSuccess<LookupPosCustomerResponse>>(
    `/pos/customers?${search.toString()}`,
  );
  return res.data;
}

// API-27
export async function getPosPromotionsApi(
  params: GetPosPromotionsParams,
): Promise<PosPromotionsResponse> {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
  });
  if (typeof params.courtId === 'number') {
    search.set('courtId', String(params.courtId));
  }
  if (params.date) {
    search.set('date', params.date);
  }
  if (params.startTime) {
    search.set('startTime', params.startTime);
  }
  if (params.endTime) {
    search.set('endTime', params.endTime);
  }
  if (params.customerPhone) {
    search.set('customerPhone', params.customerPhone.trim());
  }
  const res = await apiFetch<ApiSuccess<PosPromotionsResponse>>(
    `/pos/promotions?${search.toString()}`,
  );
  return res.data;
}

// API-28
export async function createPosBookingApi(
  body: CreatePosBookingInput,
  idempotencyKey: string,
): Promise<PosBookingWithOptionalReceiptResponse> {
  const payload: CreatePosBookingInput = {
    ...body,
    promotionCode: body.promotionCode
      ? body.promotionCode.trim().toUpperCase()
      : (body.promotionCode ?? undefined),
  };
  const res = await apiFetch<ApiSuccess<PosBookingWithOptionalReceiptResponse>>('/pos/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotencyKey,
  });
  return res.data;
}

// API-29
export async function collectPosCashApi(
  bookingCode: string,
  body: CollectPosCashInput,
  idempotencyKey: string,
): Promise<PosBookingWithReceiptResponse> {
  const res = await apiFetch<ApiSuccess<PosBookingWithReceiptResponse>>(
    `/pos/bookings/${encodeURIComponent(bookingCode)}/payments`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey,
    },
  );
  return res.data;
}

// API-30
export async function abortPosBookingApi(
  bookingCode: string,
  body: AbortPosBookingInput,
): Promise<AbortPosBookingResponse> {
  const res = await apiFetch<ApiSuccess<AbortPosBookingResponse>>(
    `/pos/bookings/${encodeURIComponent(bookingCode)}/abort`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-31
export async function getLatestReceiptApi(branchId: number): Promise<ReceiptDto | null> {
  const search = new URLSearchParams({ branchId: String(branchId) });
  const res = await apiFetch<ApiSuccess<ReceiptDto | null>>(
    `/pos/receipts/latest?${search.toString()}`,
  );
  return res.data;
}

// API-32
export async function getPosBookingsApi(
  params: GetPosBookingsParams,
): Promise<PosBookingsListResponse> {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
    date: params.date,
  });
  if (params.tab) {
    search.set('tab', params.tab);
  }
  if (params.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  if (typeof params.page === 'number') {
    search.set('page', String(params.page));
  }
  if (typeof params.pageSize === 'number') {
    search.set('pageSize', String(params.pageSize));
  }
  return apiFetch<PosBookingsListResponse>(`/pos/bookings?${search.toString()}`);
}

// API-33
export async function settlePosBookingApi(
  bookingCode: string,
  body: SettlePosBookingInput,
  idempotencyKey: string,
): Promise<PosBookingWithReceiptResponse> {
  const res = await apiFetch<ApiSuccess<PosBookingWithReceiptResponse>>(
    `/pos/bookings/${encodeURIComponent(bookingCode)}/settle`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey,
    },
  );
  return res.data;
}

// API-34
export async function checkInPosBookingApi(
  bookingCode: string,
  body: CheckInPosBookingInput,
): Promise<PosBookingTransitionResponse> {
  const res = await apiFetch<ApiSuccess<PosBookingTransitionResponse>>(
    `/pos/bookings/${encodeURIComponent(bookingCode)}/check-in`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-35
export async function completePosBookingApi(
  bookingCode: string,
  body: CompletePosBookingInput,
): Promise<PosBookingTransitionResponse> {
  const res = await apiFetch<ApiSuccess<PosBookingTransitionResponse>>(
    `/pos/bookings/${encodeURIComponent(bookingCode)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

export function usePosSchedule(
  params: {
    branchId?: number | null;
    date?: string | null;
    sportId?: number | null;
  },
  options?: { enabled?: boolean },
) {
  const hasParams =
    typeof params.branchId === 'number' &&
    params.branchId > 0 &&
    typeof params.date === 'string' &&
    params.date.length > 0;

  return useQuery({
    queryKey: posKeys.schedule({
      branchId: params.branchId ?? undefined,
      date: params.date ?? undefined,
      sportId: params.sportId ?? undefined,
    }),
    queryFn: () =>
      getPosScheduleApi({
        branchId: params.branchId as number,
        date: params.date as string,
        sportId: params.sportId ?? undefined,
      }),
    enabled: hasParams && (options?.enabled ?? true),
  });
}

export function usePosPromotions(
  params: {
    branchId?: number | null;
    courtId?: number | null;
    date?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    customerPhone?: string | null;
  } | null,
  options?: { enabled?: boolean },
) {
  const hasBranch = Boolean(params && typeof params.branchId === 'number' && params.branchId > 0);
  const normalizedParams: Partial<GetPosPromotionsParams> | null = hasBranch
    ? {
        branchId: params!.branchId as number,
        courtId: params!.courtId ?? undefined,
        date: params!.date ?? undefined,
        startTime: params!.startTime ?? undefined,
        endTime: params!.endTime ?? undefined,
        customerPhone: params!.customerPhone ?? undefined,
      }
    : null;

  return useQuery({
    queryKey: posKeys.promotions(normalizedParams),
    queryFn: () => getPosPromotionsApi(normalizedParams as GetPosPromotionsParams),
    enabled: hasBranch && (options?.enabled ?? true),
  });
}

export function useLatestReceipt(
  branchId: number | null | undefined,
  options?: { enabled?: boolean },
) {
  const hasBranch = typeof branchId === 'number' && branchId > 0;
  return useQuery({
    queryKey: posKeys.latestReceipt(branchId),
    queryFn: () => getLatestReceiptApi(branchId as number),
    enabled: hasBranch && (options?.enabled ?? true),
  });
}

export function usePosBookings(
  params: {
    branchId?: number | null;
    date?: string | null;
    tab?: PosBookingsTab;
    q?: string;
    page?: number;
    pageSize?: number;
  } | null,
  options?: { enabled?: boolean },
) {
  const hasParams = Boolean(
    params &&
      typeof params.branchId === 'number' &&
      params.branchId > 0 &&
      typeof params.date === 'string' &&
      params.date.length > 0,
  );
  const normalizedParams: Partial<GetPosBookingsParams> | null = hasParams
    ? {
        branchId: params!.branchId as number,
        date: params!.date as string,
        tab: params!.tab,
        q: params!.q,
        page: params!.page,
        pageSize: params!.pageSize,
      }
    : null;

  return useQuery({
    queryKey: posKeys.bookings(normalizedParams),
    queryFn: () => getPosBookingsApi(normalizedParams as GetPosBookingsParams),
    enabled: hasParams && (options?.enabled ?? true),
  });
}
