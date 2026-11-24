import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccess,
  AudienceType,
  DiscountType,
  PromotionStatus,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface PublicPromotionItem {
  promotionId: number;
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  timeFrom: string | null;
  timeTo: string | null;
  startDate: string;
  endDate: string;
  scopeText: string;
  branchIds: number[];
  sportIds: number[];
  audienceType: AudienceType;
  remainingUses: number | null;
}

export interface PublicPromotionCheck {
  code: string;
  name: string;
  status: PromotionStatus;
  endDate: string;
  usable: boolean;
  message: string | null;
}

export interface GetPublicPromotionsParams {
  branchId?: number;
  sportId?: number;
  limit?: number;
}

export const promotionsKeys = {
  all: ['promotions', 'public'] as const,
  list: (params?: GetPublicPromotionsParams) =>
    ['promotions', 'public', 'list', params ?? {}] as const,
  check: (code: string) => ['promotions', 'public', 'check', code] as const,
};

export async function getPublicPromotionsApi(
  params?: GetPublicPromotionsParams,
): Promise<PublicPromotionItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (typeof params?.sportId === 'number') {
    search.set('sportId', String(params.sportId));
  }
  if (typeof params?.limit === 'number') {
    search.set('limit', String(params.limit));
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<PublicPromotionItem[]>>(
    qs ? `/promotions/public?${qs}` : '/promotions/public',
  );
  return res.data;
}

export async function checkPublicPromotionApi(code: string): Promise<PublicPromotionCheck> {
  const normalized = code.trim().toUpperCase();
  const res = await apiFetch<ApiSuccess<PublicPromotionCheck>>(
    `/promotions/public/${encodeURIComponent(normalized)}`,
  );
  return res.data;
}

export function usePublicPromotions(
  params?: GetPublicPromotionsParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: promotionsKeys.list(params),
    queryFn: () => getPublicPromotionsApi(params),
    enabled: options?.enabled ?? true,
  });
}
