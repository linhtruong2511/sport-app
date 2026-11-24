import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccess,
  BookingChannel,
  BookingPriceLineDto,
  DepositType,
  PaymentOption,
  PromoReasonCode,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface QuoteRequest {
  courtId: number;
  date: string;
  startTime: string;
  endTime: string;
  promotionCode?: string;
  paymentOption?: PaymentOption;
  channel?: BookingChannel;
  customerPhone?: string;
}

export interface QuoteCourtInfo {
  courtId: number;
  name: string;
  branchName: string;
}

export interface QuotePromotionInfo {
  code: string;
  applied: boolean;
  reasonCode: PromoReasonCode | null;
  discountAmount: number;
  message: string | null;
}

export interface QuoteDepositInfo {
  type: DepositType | null;
  value: number | null;
  amount: number;
  fullPaymentRequired: boolean;
}

export interface QuoteResponse {
  court: QuoteCourtInfo;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  slotAvailable: boolean;
  priceLines: BookingPriceLineDto[];
  baseAmount: number;
  promotion: QuotePromotionInfo | null;
  discountAmount: number;
  totalAmount: number;
  deposit: QuoteDepositInfo;
  paymentOption: PaymentOption;
  amountDueNow: number;
  remainingOnArrival: number;
}

export const pricingKeys = {
  all: ['pricing'] as const,
  quote: (body: QuoteRequest | null) => ['pricing', 'quote', body] as const,
};

export async function getBookingQuoteApi(body: QuoteRequest): Promise<QuoteResponse> {
  const payload: QuoteRequest = {
    ...body,
    promotionCode: body.promotionCode ? body.promotionCode.trim().toUpperCase() : undefined,
  };
  const res = await apiFetch<ApiSuccess<QuoteResponse>>('/bookings/quote', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export function useBookingQuote(
  body: QuoteRequest | null,
  options?: { enabled?: boolean },
) {
  const hasRequiredFields = Boolean(
    body &&
      body.courtId > 0 &&
      body.date &&
      body.startTime &&
      body.endTime,
  );

  return useQuery({
    queryKey: pricingKeys.quote(body),
    queryFn: () => getBookingQuoteApi(body as QuoteRequest),
    enabled: hasRequiredFields && (options?.enabled ?? true),
  });
}
