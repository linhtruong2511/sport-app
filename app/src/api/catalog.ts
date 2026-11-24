import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess, BranchStatus, DepositType } from '@sporthub/shared';
import { apiFetch } from './client.ts';

export interface BranchOpeningHourDto {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface BranchListItem {
  branchId: number;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  courtCount: number;
  status: BranchStatus;
  openingHours: BranchOpeningHourDto[];
}

export interface SportListItem {
  sportId: number;
  code: string;
  name: string;
  icon: string | null;
  gridBlockMinutes: number;
  displayBlockMinutes?: number;
  activeCourtCount: number;
}

export interface BranchSportHoliday {
  holidayId?: number;
  name: string;
  date?: string;
  note?: string | null;
}

export interface BranchSportSummaryBranch {
  branchId: number;
  name: string;
  address: string;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
  holiday: BranchSportHoliday | null;
}

export interface BranchSportDeposit {
  type: DepositType;
  value: number;
}

export interface BranchSportSummaryItem {
  sportId: number;
  code: string;
  name: string;
  courtCount: number;
  minPricePerHour: number | null;
  maxPricePerHour: number | null;
  deposit: BranchSportDeposit | null;
  freeSlotCount: number;
}

export interface BranchSportSummary {
  branch: BranchSportSummaryBranch;
  sports: BranchSportSummaryItem[];
}

export interface GetBranchesParams {
  status?: 'ACTIVE' | 'ALL';
}

export interface GetSportsParams {
  branchId?: number;
}

export interface GetBranchSportSummaryParams {
  date?: string;
}

export const catalogKeys = {
  all: ['catalog'] as const,
  branches: (params?: GetBranchesParams) => ['catalog', 'branches', params ?? {}] as const,
  sports: (params?: GetSportsParams) => ['catalog', 'sports', params ?? {}] as const,
  branchSportSummary: (branchId: number | null | undefined, params?: GetBranchSportSummaryParams) =>
    ['catalog', 'branch-sport-summary', branchId ?? null, params ?? {}] as const,
};

export async function getBranchesApi(params?: GetBranchesParams): Promise<BranchListItem[]> {
  const search = new URLSearchParams();
  if (params?.status) {
    search.set('status', params.status);
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<BranchListItem[]>>(qs ? `/branches?${qs}` : '/branches');
  return res.data;
}

export async function getSportsApi(params?: GetSportsParams): Promise<SportListItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<SportListItem[]>>(qs ? `/sports?${qs}` : '/sports');
  return res.data;
}

export async function getBranchSportSummaryApi(
  branchId: number,
  params?: GetBranchSportSummaryParams,
): Promise<BranchSportSummary> {
  const search = new URLSearchParams();
  if (params?.date) {
    search.set('date', params.date);
  }
  const qs = search.toString();
  const path = qs
    ? `/branches/${branchId}/sport-summary?${qs}`
    : `/branches/${branchId}/sport-summary`;
  const res = await apiFetch<ApiSuccess<BranchSportSummary>>(path);
  return res.data;
}

export function useBranches(params?: GetBranchesParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: catalogKeys.branches(params),
    queryFn: () => getBranchesApi(params),
    enabled: options?.enabled ?? true,
  });
}

export function useSports(params?: GetSportsParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: catalogKeys.sports(params),
    queryFn: () => getSportsApi(params),
    enabled: options?.enabled ?? true,
  });
}

export function useBranchSportSummary(
  branchId: number | null | undefined,
  params?: GetBranchSportSummaryParams,
  options?: { enabled?: boolean },
) {
  const isValidBranch = typeof branchId === 'number' && branchId > 0;
  return useQuery({
    queryKey: catalogKeys.branchSportSummary(branchId, params),
    queryFn: () => getBranchSportSummaryApi(branchId as number, params),
    enabled: isValidBranch && (options?.enabled ?? true),
  });
}
