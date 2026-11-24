import { useQuery } from '@tanstack/react-query';
import type {
  ApiListSuccess,
  ApiSuccess,
  BookingDetailDto,
  BookingRefundSummaryDto,
  BookingStatus,
  BookingSummaryDto,
  CancelType,
  PaymentOption,
  PaymentRequestDto,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface CreateOnlineBookingInput {
  courtId: number;
  date: string;
  startTime: string;
  endTime: string;
  paymentOption: PaymentOption;
  promotionCode?: string | null;
  note?: string | null;
}

export interface CreateOnlineBookingResponse {
  booking: BookingSummaryDto;
  paymentRequest: PaymentRequestDto | null;
}

export interface MyBookingsParams {
  from: string;
  to: string;
  status?: 'ALL' | BookingStatus;
  page?: number;
  pageSize?: number;
}

export type MyBookingsListResponse = ApiListSuccess<BookingSummaryDto> & {
  meta: {
    statusCounts: Record<'ALL' | BookingStatus, number>;
  };
};

export interface CancelPreviewResponse {
  cancelType: CancelType;
  canCancel: boolean;
  reasonIfNot: string | null;
  daysBeforeStart: number;
  paidAmount: number;
  depositKept: number;
  refundableBase: number;
  refundRate: number;
  refundAmount: number;
  retainedAmount: number;
  policyText: string;
}

export interface CancelBookingInput {
  cancelType?: CancelType;
  reason: string;
  version: string;
}

export interface CancelBookingResponse {
  booking: BookingSummaryDto;
  refund: BookingRefundSummaryDto | null;
}

export const bookingsKeys = {
  all: ['bookings'] as const,
  detail: (bookingCode: string | null | undefined) =>
    ['bookings', 'detail', bookingCode ?? null] as const,
  myList: (params?: Partial<MyBookingsParams>) =>
    ['bookings', 'my-list', params ?? {}] as const,
  cancelPreview: (bookingCode: string | null | undefined, cancelType?: CancelType) =>
    ['bookings', 'cancel-preview', bookingCode ?? null, cancelType ?? null] as const,
};

export async function createBookingApi(
  body: CreateOnlineBookingInput,
  idempotencyKey: string,
): Promise<CreateOnlineBookingResponse> {
  const payload: CreateOnlineBookingInput = {
    ...body,
    promotionCode: body.promotionCode
      ? body.promotionCode.trim().toUpperCase()
      : (body.promotionCode ?? undefined),
  };
  const res = await apiFetch<ApiSuccess<CreateOnlineBookingResponse>>('/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotencyKey,
  });
  return res.data;
}

export async function getBookingDetailApi(bookingCode: string): Promise<BookingDetailDto> {
  const res = await apiFetch<ApiSuccess<BookingDetailDto>>(
    `/bookings/${encodeURIComponent(bookingCode)}`,
  );
  return res.data;
}

export async function getMyBookingsApi(
  params: MyBookingsParams,
): Promise<MyBookingsListResponse> {
  const search = new URLSearchParams({
    from: params.from,
    to: params.to,
  });
  if (params.status) {
    search.set('status', params.status);
  }
  if (typeof params.page === 'number') {
    search.set('page', String(params.page));
  }
  if (typeof params.pageSize === 'number') {
    search.set('pageSize', String(params.pageSize));
  }
  return apiFetch<MyBookingsListResponse>(`/me/bookings?${search.toString()}`);
}

export async function getCancelPreviewApi(
  bookingCode: string,
  cancelType?: CancelType,
): Promise<CancelPreviewResponse> {
  const search = new URLSearchParams();
  if (cancelType) {
    search.set('cancelType', cancelType);
  }
  const qs = search.toString();
  const path = qs
    ? `/bookings/${encodeURIComponent(bookingCode)}/cancel-preview?${qs}`
    : `/bookings/${encodeURIComponent(bookingCode)}/cancel-preview`;
  const res = await apiFetch<ApiSuccess<CancelPreviewResponse>>(path);
  return res.data;
}

export async function cancelBookingApi(
  bookingCode: string,
  body: CancelBookingInput,
): Promise<CancelBookingResponse> {
  const res = await apiFetch<ApiSuccess<CancelBookingResponse>>(
    `/bookings/${encodeURIComponent(bookingCode)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

export function useBookingDetail(
  bookingCode: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const hasCode = typeof bookingCode === 'string' && bookingCode.length > 0;
  return useQuery({
    queryKey: bookingsKeys.detail(bookingCode),
    queryFn: () => getBookingDetailApi(bookingCode as string),
    enabled: hasCode && (options?.enabled ?? true),
  });
}

export function useMyBookings(
  params: MyBookingsParams | null,
  options?: { enabled?: boolean },
) {
  const hasRange = Boolean(params && params.from && params.to);
  return useQuery({
    queryKey: bookingsKeys.myList(params ?? undefined),
    queryFn: () => getMyBookingsApi(params as MyBookingsParams),
    enabled: hasRange && (options?.enabled ?? true),
  });
}

export function useCancelPreview(
  bookingCode: string | null | undefined,
  cancelType?: CancelType,
  options?: { enabled?: boolean },
) {
  const hasCode = typeof bookingCode === 'string' && bookingCode.length > 0;
  return useQuery({
    queryKey: bookingsKeys.cancelPreview(bookingCode, cancelType),
    queryFn: () => getCancelPreviewApi(bookingCode as string, cancelType),
    enabled: hasCode && (options?.enabled ?? true),
  });
}
