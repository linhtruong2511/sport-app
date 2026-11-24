import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccess,
  BookingStatus,
  PaymentPurpose,
  PaymentRequestDto,
  PaymentRequestStatus,
  PaymentStatus,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface CreatePaymentRequestInput {
  purpose?: PaymentPurpose | null;
}

export interface RecheckPaymentBookingSnapshot {
  bookingCode: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  remainingAmount: number;
  version: string;
}

export interface RecheckPaymentResponse {
  requestId: number;
  status: PaymentRequestStatus;
  message: string;
  booking?: RecheckPaymentBookingSnapshot | null;
}

export const paymentsKeys = {
  all: ['payments'] as const,
  request: (bookingCode: string | null | undefined) =>
    ['payments', 'request', bookingCode ?? null] as const,
};

export async function getPaymentRequestApi(bookingCode: string): Promise<PaymentRequestDto> {
  const res = await apiFetch<ApiSuccess<PaymentRequestDto>>(
    `/bookings/${encodeURIComponent(bookingCode)}/payment-request`,
  );
  return res.data;
}

export async function createPaymentRequestApi(
  bookingCode: string,
  body: CreatePaymentRequestInput,
  idempotencyKey: string,
): Promise<PaymentRequestDto> {
  const res = await apiFetch<ApiSuccess<PaymentRequestDto>>(
    `/bookings/${encodeURIComponent(bookingCode)}/payment-requests`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey,
    },
  );
  return res.data;
}

export async function recheckPaymentRequestApi(
  requestId: number,
): Promise<RecheckPaymentResponse> {
  const res = await apiFetch<ApiSuccess<RecheckPaymentResponse>>(
    `/payment-requests/${requestId}/recheck`,
    {
      method: 'POST',
    },
  );
  return res.data;
}

export function usePaymentRequest(
  bookingCode: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const hasCode = typeof bookingCode === 'string' && bookingCode.length > 0;
  return useQuery({
    queryKey: paymentsKeys.request(bookingCode),
    queryFn: () => getPaymentRequestApi(bookingCode as string),
    enabled: hasCode && (options?.enabled ?? true),
  });
}
