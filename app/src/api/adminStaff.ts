import { useQuery } from '@tanstack/react-query';
import type {
  ApiListSuccess,
  ApiSuccess,
  PaymentMethod,
  PaymentPurpose,
  UserStatus,
} from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface AdminStaffBranchRef {
  branchId: number;
  name: string;
}

export interface AdminStaffItem {
  userId: number;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  branch: AdminStaffBranchRef;
  status: UserStatus;
  counterBookingCount: number;
  collectedAmount: number;
  lastLoginAt: string | null;
}

export interface GetAdminStaffParams {
  branchId?: number;
  status?: UserStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

export type AdminStaffListResponse = ApiListSuccess<AdminStaffItem> & {
  meta: {
    activeCount: number;
    lockedCount: number;
    countByBranch: Record<string, number>;
  };
};

export interface CreateStaffInput {
  fullName: string;
  phone: string;
  email?: string | null;
  branchId: number;
  password: string;
  status?: UserStatus;
}

export interface UpdateStaffInput {
  fullName: string;
  phone: string;
  email?: string | null;
  branchId: number;
  password?: string | null;
  status?: UserStatus;
}

export interface GetStaffPaymentsParams {
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface StaffPaymentItem {
  paymentCode: string;
  bookingCode: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: number;
  collectedByName: string | null;
  paidAt: string;
}

export type StaffPaymentsListResponse = ApiListSuccess<StaffPaymentItem> & {
  meta: {
    totalAmount: number;
  };
};

export const adminStaffKeys = {
  all: ['admin-staff'] as const,
  list: (params?: GetAdminStaffParams) => ['admin-staff', 'list', params ?? {}] as const,
  payments: (userId: number | null | undefined, params?: GetStaffPaymentsParams) =>
    ['admin-staff', 'payments', userId ?? null, params ?? {}] as const,
};

// API-42
export async function getAdminStaff(
  params?: GetAdminStaffParams,
): Promise<AdminStaffListResponse> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (params?.status) {
    search.set('status', params.status);
  }
  if (params?.q && params.q.trim().length > 0) {
    search.set('q', params.q.trim());
  }
  if (typeof params?.page === 'number') {
    search.set('page', String(params.page));
  }
  if (typeof params?.pageSize === 'number') {
    search.set('pageSize', String(params.pageSize));
  }
  const qs = search.toString();
  return apiFetch<AdminStaffListResponse>(qs ? `/admin/staff?${qs}` : '/admin/staff');
}

// API-43
export async function createStaff(body: CreateStaffInput): Promise<AdminStaffItem> {
  const res = await apiFetch<ApiSuccess<AdminStaffItem>>('/admin/staff', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

// API-44
export async function updateStaff(
  userId: number,
  body: UpdateStaffInput,
): Promise<AdminStaffItem> {
  const res = await apiFetch<ApiSuccess<AdminStaffItem>>(`/admin/staff/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.data;
}

// API-45 (lock)
export async function lockStaff(userId: number): Promise<AdminStaffItem> {
  const res = await apiFetch<ApiSuccess<AdminStaffItem>>(`/admin/staff/${userId}/lock`, {
    method: 'POST',
  });
  return res.data;
}

// API-45 (unlock)
export async function unlockStaff(userId: number): Promise<AdminStaffItem> {
  const res = await apiFetch<ApiSuccess<AdminStaffItem>>(`/admin/staff/${userId}/unlock`, {
    method: 'POST',
  });
  return res.data;
}

// API-46
export async function getStaffPayments(
  userId: number,
  params?: GetStaffPaymentsParams,
): Promise<StaffPaymentsListResponse> {
  const search = new URLSearchParams();
  if (params?.from) {
    search.set('from', params.from);
  }
  if (params?.to) {
    search.set('to', params.to);
  }
  if (typeof params?.page === 'number') {
    search.set('page', String(params.page));
  }
  if (typeof params?.pageSize === 'number') {
    search.set('pageSize', String(params.pageSize));
  }
  const qs = search.toString();
  const path = qs
    ? `/admin/staff/${userId}/payments?${qs}`
    : `/admin/staff/${userId}/payments`;
  return apiFetch<StaffPaymentsListResponse>(path);
}

export function useAdminStaff(
  params?: GetAdminStaffParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminStaffKeys.list(params),
    queryFn: () => getAdminStaff(params),
    enabled: options?.enabled ?? true,
  });
}

export function useStaffPayments(
  userId: number | null | undefined,
  params?: GetStaffPaymentsParams,
  options?: { enabled?: boolean },
) {
  const isValidUser = typeof userId === 'number' && userId > 0;
  return useQuery({
    queryKey: adminStaffKeys.payments(userId, params),
    queryFn: () => getStaffPayments(userId as number, params),
    enabled: isValidUser && (options?.enabled ?? true),
  });
}
