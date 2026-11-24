import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccess,
  AudienceType,
  DiscountType,
  PromotionNotifyStatus,
  PromotionStatus,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface AdminPromotionBranchRef {
  branchId: number;
  name: string;
}

export interface AdminPromotionSportRef {
  sportId: number;
  name: string;
}

export interface AdminPromotionCustomerRef {
  userId: number;
  fullName: string;
  phone: string;
}

export interface AdminPromotionItem {
  promotionId: number;
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  allBranches: boolean;
  branches: AdminPromotionBranchRef[];
  allSports: boolean;
  sports: AdminPromotionSportRef[];
  timeFrom: string | null;
  timeTo: string | null;
  startDate: string;
  endDate: string;
  audienceType: AudienceType;
  customerCount: number;
  maxUses: number;
  usedCount: number;
  status: PromotionStatus;
  notifyStatus: PromotionNotifyStatus;
  createdAt: string;
}

export interface AdminPromotionDetail extends AdminPromotionItem {
  customers: AdminPromotionCustomerRef[];
}

export interface GetAdminPromotionsParams {
  status?: PromotionStatus;
  q?: string;
}

export interface CreatePromotionInput {
  name: string;
  code: string;
  description?: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountAmount?: number | null;
  allBranches: boolean;
  branchIds: number[];
  allSports: boolean;
  sportIds: number[];
  timeFrom?: string | null;
  timeTo?: string | null;
  startDate: string;
  endDate: string;
  maxUses: number;
  audienceType: AudienceType;
  customerPhones?: string[];
  notifyCustomers?: boolean;
}

export type UpdatePromotionInput = CreatePromotionInput;

export interface PromotionStatusResponse {
  promotionId: number;
  status: PromotionStatus;
}

export interface DeletePromotionDeletedResponse {
  promotionId: number;
  deleted: true;
}

export interface DeletePromotionDiscontinuedResponse {
  promotionId: number;
  deleted: false;
  status: Extract<PromotionStatus, 'DISCONTINUED'>;
  message: string;
}

export type DeletePromotionResponse =
  | DeletePromotionDeletedResponse
  | DeletePromotionDiscontinuedResponse;

export interface NotifyPromotionResponse {
  promotionId: number;
  notifyStatus: PromotionNotifyStatus;
}

export const adminPromotionsKeys = {
  all: ['admin-promotions'] as const,
  list: (params?: GetAdminPromotionsParams) =>
    ['admin-promotions', 'list', params ?? {}] as const,
  detail: (promotionId: number | null | undefined) =>
    ['admin-promotions', 'detail', promotionId ?? null] as const,
};

// API-59
export async function getAdminPromotions(
  params?: GetAdminPromotionsParams,
): Promise<AdminPromotionItem[]> {
  const search = new URLSearchParams();
  if (params?.status) {
    search.set('status', params.status);
  }
  if (params?.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<AdminPromotionItem[]>>(
    qs ? `/admin/promotions?${qs}` : '/admin/promotions',
  );
  return res.data;
}

// API-60
export async function getAdminPromotion(promotionId: number): Promise<AdminPromotionDetail> {
  const res = await apiFetch<ApiSuccess<AdminPromotionDetail>>(
    `/admin/promotions/${promotionId}`,
  );
  return res.data;
}

// API-61
export async function createPromotion(
  body: CreatePromotionInput,
): Promise<AdminPromotionItem> {
  const payload: CreatePromotionInput = {
    ...body,
    code: body.code.trim().toUpperCase(),
  };
  const res = await apiFetch<ApiSuccess<AdminPromotionItem>>('/admin/promotions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

// API-62
export async function updatePromotion(
  promotionId: number,
  body: UpdatePromotionInput,
): Promise<AdminPromotionItem> {
  const payload: UpdatePromotionInput = {
    ...body,
    code: body.code.trim().toUpperCase(),
  };
  const res = await apiFetch<ApiSuccess<AdminPromotionItem>>(
    `/admin/promotions/${promotionId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

// API-63 (pause)
export async function pausePromotion(promotionId: number): Promise<PromotionStatusResponse> {
  const res = await apiFetch<ApiSuccess<PromotionStatusResponse>>(
    `/admin/promotions/${promotionId}/pause`,
    {
      method: 'POST',
    },
  );
  return res.data;
}

// API-63 (resume)
export async function resumePromotion(promotionId: number): Promise<PromotionStatusResponse> {
  const res = await apiFetch<ApiSuccess<PromotionStatusResponse>>(
    `/admin/promotions/${promotionId}/resume`,
    {
      method: 'POST',
    },
  );
  return res.data;
}

// API-64
export async function deletePromotion(promotionId: number): Promise<DeletePromotionResponse> {
  const res = await apiFetch<ApiSuccess<DeletePromotionDiscontinuedResponse> | undefined>(
    `/admin/promotions/${promotionId}`,
    {
      method: 'DELETE',
    },
  );
  if (!res) {
    return {
      promotionId,
      deleted: true,
    };
  }
  return res.data;
}

// API-65
export async function notifyPromotion(promotionId: number): Promise<NotifyPromotionResponse> {
  const res = await apiFetch<ApiSuccess<NotifyPromotionResponse>>(
    `/admin/promotions/${promotionId}/notify`,
    {
      method: 'POST',
    },
  );
  return res.data;
}

export function useAdminPromotions(
  params?: GetAdminPromotionsParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminPromotionsKeys.list(params),
    queryFn: () => getAdminPromotions(params),
    enabled: options?.enabled ?? true,
  });
}

export function useAdminPromotion(
  promotionId: number | null | undefined,
  options?: { enabled?: boolean },
) {
  const isValidId = typeof promotionId === 'number' && promotionId > 0;
  return useQuery({
    queryKey: adminPromotionsKeys.detail(promotionId),
    queryFn: () => getAdminPromotion(promotionId as number),
    enabled: isValidId && (options?.enabled ?? true),
  });
}
