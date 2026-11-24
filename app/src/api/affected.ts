import { useQuery } from '@tanstack/react-query';
import type {
  AffectedReason,
  ApiSuccess,
  BookingRefundSummaryDto,
  BookingStatus,
  BookingSummaryDto,
  CancelType,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface AffectedReasonItem {
  type: AffectedReason;
  refId: number;
  description: string;
}

export type AffectedBookingItem = BookingSummaryDto & {
  affectedReasons: AffectedReasonItem[];
};

export interface GetAffectedBookingsParams {
  branchId?: number;
}

export interface GetReassignOptionsParams {
  date?: string;
  startTime?: string;
  endTime?: string;
}

export interface ReassignTimeOption {
  startTime: string;
  endTime: string;
}

export interface ReassignCandidateCourt {
  courtId: number;
  code: string;
  name: string;
}

export interface ReassignOptionsResponse {
  durationMinutes: number;
  timeOptions: ReassignTimeOption[];
  courts: ReassignCandidateCourt[];
}

export interface ReassignBookingInput {
  newCourtId: number;
  date: string;
  startTime: string;
  endTime: string;
  note?: string | null;
  version: string;
}

export interface ReassignTransferSummary {
  transferId: number;
  oldCourtName: string;
  newCourtName: string;
  performedAt: string;
}

export interface ReassignBookingResponse {
  booking: AffectedBookingItem;
  transfer: ReassignTransferSummary;
}

export interface CloseAffectedBookingInput {
  note?: string | null;
  version: string;
}

export interface CloseAffectedBookingResponse {
  bookingCode: string;
  status: Extract<BookingStatus, 'CANCELED'>;
  cancelType: Extract<CancelType, 'BY_FACILITY'>;
  refund: BookingRefundSummaryDto | null;
}

export const affectedKeys = {
  all: ['affected-bookings'] as const,
  list: (params?: { branchId?: number | null }) =>
    ['affected-bookings', 'list', params?.branchId ?? null] as const,
  reassignOptions: (
    bookingCode: string | null | undefined,
    params?: GetReassignOptionsParams,
  ) => ['affected-bookings', 'reassign-options', bookingCode ?? null, params ?? {}] as const,
};

// API-36
export async function getAffectedBookingsApi(
  params?: GetAffectedBookingsParams,
): Promise<AffectedBookingItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<AffectedBookingItem[]>>(
    qs ? `/affected-bookings?${qs}` : '/affected-bookings',
  );
  return res.data;
}

// API-37
export async function getReassignOptionsApi(
  bookingCode: string,
  params?: GetReassignOptionsParams,
): Promise<ReassignOptionsResponse> {
  const search = new URLSearchParams();
  if (params?.date) {
    search.set('date', params.date);
  }
  if (params?.startTime) {
    search.set('startTime', params.startTime);
  }
  if (params?.endTime) {
    search.set('endTime', params.endTime);
  }
  const qs = search.toString();
  const path = qs
    ? `/affected-bookings/${encodeURIComponent(bookingCode)}/reassign-options?${qs}`
    : `/affected-bookings/${encodeURIComponent(bookingCode)}/reassign-options`;
  const res = await apiFetch<ApiSuccess<ReassignOptionsResponse>>(path);
  return res.data;
}

// API-38
export async function reassignBookingApi(
  bookingCode: string,
  body: ReassignBookingInput,
): Promise<ReassignBookingResponse> {
  const res = await apiFetch<ApiSuccess<ReassignBookingResponse>>(
    `/affected-bookings/${encodeURIComponent(bookingCode)}/reassign`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-39
export async function closeAffectedBookingApi(
  bookingCode: string,
  body: CloseAffectedBookingInput,
): Promise<CloseAffectedBookingResponse> {
  const res = await apiFetch<ApiSuccess<CloseAffectedBookingResponse>>(
    `/affected-bookings/${encodeURIComponent(bookingCode)}/close`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

export function useAffectedBookings(
  params?: { branchId?: number | null },
  options?: { enabled?: boolean },
) {
  const normalizedParams: GetAffectedBookingsParams | undefined =
    typeof params?.branchId === 'number' && params.branchId > 0
      ? { branchId: params.branchId }
      : undefined;

  return useQuery({
    queryKey: affectedKeys.list(params),
    queryFn: () => getAffectedBookingsApi(normalizedParams),
    enabled: options?.enabled ?? true,
  });
}

export function useReassignOptions(
  bookingCode: string | null | undefined,
  params?: GetReassignOptionsParams,
  options?: { enabled?: boolean },
) {
  const hasCode = typeof bookingCode === 'string' && bookingCode.length > 0;
  return useQuery({
    queryKey: affectedKeys.reassignOptions(bookingCode, params),
    queryFn: () => getReassignOptionsApi(bookingCode as string, params),
    enabled: hasCode && (options?.enabled ?? true),
  });
}
