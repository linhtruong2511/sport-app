import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess, BlockType, CourtStatus, DepositType } from '@sporthub/shared';
import type { AffectedBookingItem } from './affected.ts';
import { apiFetch } from './client.ts';

export type CourtDisplayStatus = 'ACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED' | 'INACTIVE';

export interface AdminCourtBranchRef {
  branchId: number;
  name: string;
}

export interface AdminCourtSportRef {
  sportId: number;
  code: string;
  name: string;
}

export interface AdminCourtPriceRuleDto {
  priceRuleId: number;
  label: string;
  dayOfWeekMask: number;
  startTime: string;
  endTime: string;
  pricePerHour: number;
}

export interface AdminCourtActiveBlockDto {
  blockId: number;
  blockType: BlockType;
  startAt: string;
  endAt: string | null;
  reason: string;
}

export interface AdminCourtItem {
  courtId: number;
  code: string;
  name: string;
  branch: AdminCourtBranchRef;
  sport: AdminCourtSportRef;
  courtType: string | null;
  description: string | null;
  depositType: DepositType;
  depositValue: number;
  status: CourtStatus;
  displayStatus: CourtDisplayStatus;
  priceRules: AdminCourtPriceRuleDto[];
  activeBlock: AdminCourtActiveBlockDto | null;
}

export interface AdminCourtDetail extends AdminCourtItem {
  hasOpenBookings: boolean;
}

export interface GetAdminCourtsParams {
  branchId?: number;
  sportId?: number;
  status?: CourtStatus;
}

export interface AdminCourtPriceRuleInput {
  label: string;
  dayOfWeekMask?: number;
  startTime: string;
  endTime: string;
  pricePerHour: number;
}

export interface CreateCourtInput {
  name: string;
  branchId: number;
  sportId: number;
  courtType?: string | null;
  description?: string | null;
  depositType: DepositType;
  depositValue: number;
  status?: CourtStatus;
  priceRules: AdminCourtPriceRuleInput[];
}

export interface UpdateCourtInput {
  name: string;
  branchId: number;
  courtType?: string | null;
  description?: string | null;
  depositType: DepositType;
  depositValue: number;
  status?: CourtStatus;
  priceRules: AdminCourtPriceRuleInput[];
}

export interface UpdateCourtResponse {
  court: AdminCourtItem;
  affectedCount: number;
}

export interface GetCourtBlocksParams {
  branchId?: number;
  active?: boolean;
}

export interface CourtBlockCourtRef {
  courtId: number;
  code: string;
  name: string;
  branchName: string;
}

export interface CourtBlockItem {
  blockId: number;
  court: CourtBlockCourtRef;
  blockType: BlockType;
  startAt: string;
  endAt: string | null;
  reason: string;
  createdByName: string;
  createdAt: string;
}

export interface CreateCourtBlockInput {
  courtId: number;
  blockType: BlockType;
  startAt: string;
  endAt?: string | null;
  reason: string;
}

export interface CreatedCourtBlockSummary {
  blockId: number;
  courtId: number;
  blockType: BlockType;
}

export interface CreateCourtBlockResponse {
  block: CreatedCourtBlockSummary | null;
  affectedCount: number;
  affectedBookings: AffectedBookingItem[];
}

export interface ReleaseCourtBlockResponse {
  blockId: number;
  releasedAt: string;
  releasedByName: string;
}

export interface AdminOpeningHourDay {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface BranchOpeningHoursResponse {
  branchId: number;
  days: AdminOpeningHourDay[];
}

export interface UpdateOpeningHoursInput {
  days: AdminOpeningHourDay[];
}

export interface UpdateOpeningHoursResponse {
  branchId: number;
  days: AdminOpeningHourDay[];
  affectedCount: number;
  affectedBookings: AffectedBookingItem[];
}

export interface GetHolidaysParams {
  branchId?: number;
  from?: string;
}

export interface AdminHolidayItem {
  holidayId: number;
  branch: AdminCourtBranchRef;
  startDate: string;
  endDate: string;
  reason: string;
  groupKey: string | null;
}

export type HolidayScope = 'ALL' | 'BRANCH';

export interface CreateHolidayInput {
  startDate: string;
  days: number;
  scope: HolidayScope;
  branchId?: number | null;
  reason?: string | null;
}

export interface CreatedHolidayRef {
  holidayId: number;
  branchId: number;
}

export interface CreateHolidayResponse {
  holidays: CreatedHolidayRef[];
  affectedCount: number;
  affectedBookings: AffectedBookingItem[];
}

export const adminCourtsKeys = {
  all: ['admin-courts'] as const,
  courts: (params?: GetAdminCourtsParams) => ['admin-courts', 'courts', params ?? {}] as const,
  courtDetail: (courtId: number | null | undefined) =>
    ['admin-courts', 'court-detail', courtId ?? null] as const,
  courtBlocks: (params?: GetCourtBlocksParams) =>
    ['admin-courts', 'court-blocks', params ?? {}] as const,
  openingHours: (branchId: number | null | undefined) =>
    ['admin-courts', 'opening-hours', branchId ?? null] as const,
  holidays: (params?: GetHolidaysParams) => ['admin-courts', 'holidays', params ?? {}] as const,
};

// API-47
export async function getAdminCourtsApi(
  params?: GetAdminCourtsParams,
): Promise<AdminCourtItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (typeof params?.sportId === 'number') {
    search.set('sportId', String(params.sportId));
  }
  if (params?.status) {
    search.set('status', params.status);
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<AdminCourtItem[]>>(
    qs ? `/admin/courts?${qs}` : '/admin/courts',
  );
  return res.data;
}

// API-48
export async function getAdminCourtDetailApi(courtId: number): Promise<AdminCourtDetail> {
  const res = await apiFetch<ApiSuccess<AdminCourtDetail>>(`/admin/courts/${courtId}`);
  return res.data;
}

// API-49
export async function createCourtApi(body: CreateCourtInput): Promise<AdminCourtItem> {
  const res = await apiFetch<ApiSuccess<AdminCourtItem>>('/admin/courts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

// API-50
export async function updateCourtApi(
  courtId: number,
  body: UpdateCourtInput,
): Promise<UpdateCourtResponse> {
  const res = await apiFetch<ApiSuccess<UpdateCourtResponse>>(`/admin/courts/${courtId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.data;
}

// API-51
export async function getCourtBlocksApi(
  params?: GetCourtBlocksParams,
): Promise<CourtBlockItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (typeof params?.active === 'boolean') {
    search.set('active', String(params.active));
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<CourtBlockItem[]>>(
    qs ? `/admin/court-blocks?${qs}` : '/admin/court-blocks',
  );
  return res.data;
}

// API-52
export async function createCourtBlockApi(
  body: CreateCourtBlockInput,
  options?: { dryRun?: boolean },
): Promise<CreateCourtBlockResponse> {
  const search = new URLSearchParams();
  if (typeof options?.dryRun === 'boolean') {
    search.set('dryRun', String(options.dryRun));
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<CreateCourtBlockResponse>>(
    qs ? `/admin/court-blocks?${qs}` : '/admin/court-blocks',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-53
export async function releaseCourtBlockApi(blockId: number): Promise<ReleaseCourtBlockResponse> {
  const res = await apiFetch<ApiSuccess<ReleaseCourtBlockResponse>>(
    `/admin/court-blocks/${blockId}/release`,
    {
      method: 'POST',
    },
  );
  return res.data;
}

// API-54
export async function getOpeningHoursApi(
  branchId: number,
): Promise<BranchOpeningHoursResponse> {
  const res = await apiFetch<ApiSuccess<BranchOpeningHoursResponse>>(
    `/admin/branches/${branchId}/opening-hours`,
  );
  return res.data;
}

// API-55
export async function updateOpeningHoursApi(
  branchId: number,
  body: UpdateOpeningHoursInput,
  options?: { dryRun?: boolean },
): Promise<UpdateOpeningHoursResponse> {
  const search = new URLSearchParams();
  if (typeof options?.dryRun === 'boolean') {
    search.set('dryRun', String(options.dryRun));
  }
  const qs = search.toString();
  const path = qs
    ? `/admin/branches/${branchId}/opening-hours?${qs}`
    : `/admin/branches/${branchId}/opening-hours`;
  const res = await apiFetch<ApiSuccess<UpdateOpeningHoursResponse>>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.data;
}

// API-56
export async function getHolidaysApi(params?: GetHolidaysParams): Promise<AdminHolidayItem[]> {
  const search = new URLSearchParams();
  if (typeof params?.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (params?.from) {
    search.set('from', params.from);
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<AdminHolidayItem[]>>(
    qs ? `/admin/holidays?${qs}` : '/admin/holidays',
  );
  return res.data;
}

// API-57
export async function createHolidayApi(
  body: CreateHolidayInput,
  options?: { dryRun?: boolean },
): Promise<CreateHolidayResponse> {
  const search = new URLSearchParams();
  if (typeof options?.dryRun === 'boolean') {
    search.set('dryRun', String(options.dryRun));
  }
  const qs = search.toString();
  const res = await apiFetch<ApiSuccess<CreateHolidayResponse>>(
    qs ? `/admin/holidays?${qs}` : '/admin/holidays',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return res.data;
}

// API-58
export async function deleteHolidayApi(
  holidayId: number,
  options?: { group?: boolean },
): Promise<void> {
  const search = new URLSearchParams();
  if (typeof options?.group === 'boolean') {
    search.set('group', String(options.group));
  }
  const qs = search.toString();
  await apiFetch<void>(qs ? `/admin/holidays/${holidayId}?${qs}` : `/admin/holidays/${holidayId}`, {
    method: 'DELETE',
  });
}

export function useAdminCourts(
  params?: GetAdminCourtsParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminCourtsKeys.courts(params),
    queryFn: () => getAdminCourtsApi(params),
    enabled: options?.enabled ?? true,
  });
}

export function useAdminCourtDetail(
  courtId: number | null | undefined,
  options?: { enabled?: boolean },
) {
  const isValidId = typeof courtId === 'number' && courtId > 0;
  return useQuery({
    queryKey: adminCourtsKeys.courtDetail(courtId),
    queryFn: () => getAdminCourtDetailApi(courtId as number),
    enabled: isValidId && (options?.enabled ?? true),
  });
}

export function useCourtBlocks(
  params?: GetCourtBlocksParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: adminCourtsKeys.courtBlocks(params),
    queryFn: () => getCourtBlocksApi(params),
    enabled: options?.enabled ?? true,
  });
}

export function useOpeningHours(
  branchId: number | null | undefined,
  options?: { enabled?: boolean },
) {
  const isValidBranch = typeof branchId === 'number' && branchId > 0;
  return useQuery({
    queryKey: adminCourtsKeys.openingHours(branchId),
    queryFn: () => getOpeningHoursApi(branchId as number),
    enabled: isValidBranch && (options?.enabled ?? true),
  });
}

export function useHolidays(params?: GetHolidaysParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: adminCourtsKeys.holidays(params),
    queryFn: () => getHolidaysApi(params),
    enabled: options?.enabled ?? true,
  });
}
