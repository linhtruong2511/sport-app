import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess, BlockType, BookingSummaryDto, CourtStatus } from '@sporthub/shared';
import { apiFetch } from './client.ts';

export type DashboardBranchParam = number | 'all';

export type DailyDashboardKpi = 'TOTAL' | 'PLAYING' | 'PENDING' | 'REVENUE';

export type DashboardCourtState = 'FREE' | 'UPCOMING' | 'IN_USE' | 'LOCKED';

export interface DailyDashboardKpis {
  totalBookings: number;
  onlineBookings: number;
  counterBookings: number;
  playingCount?: number;
  pendingCount?: number;
  playingCourts: number;
  totalCourts: number;
  freeCourts: number;
  maintenanceCourts: number;
  waitingPayment: number;
  waitingCheckin: number;
  revenue?: number;
  affectedCount?: number;
}

export interface DailyDashboardRevenue {
  total: number;
  grossPayments?: number;
  refunds?: number;
  bankTransfer: number;
  cash: number;
  fullyPaidAmount: number;
  depositCollected: number;
  depositKept: number;
}

export interface DashboardCourtCurrentBooking {
  bookingCode: string;
  customerName: string;
  startTime?: string;
  endTime: string;
}

export interface DashboardCourtNextBooking {
  bookingCode: string;
  customerName?: string;
  startTime: string;
  endTime?: string;
}

export interface DashboardCourtBlockInfo {
  blockId?: number;
  blockType?: BlockType;
  reason: string;
  startAt?: string;
  endAt: string | null;
}

export interface DashboardCourtBoardItem {
  courtId: number;
  code?: string;
  name: string;
  branchId?: number;
  branchName?: string;
  courtStatus?: CourtStatus;
  status: DashboardCourtState;
  currentBooking: DashboardCourtCurrentBooking | null;
  nextBooking: DashboardCourtNextBooking | null;
  block: DashboardCourtBlockInfo | null;
}

export interface DailyDashboardResponse {
  date: string;
  branchId: DashboardBranchParam;
  kpis: DailyDashboardKpis;
  revenue: DailyDashboardRevenue;
  courtBoard: DashboardCourtBoardItem[];
  upcoming: BookingSummaryDto[];
}

export type DailyDashboardBookingItem = BookingSummaryDto & {
  retainedAmount?: number;
};

export interface GetDailyDashboardParams {
  branchId: DashboardBranchParam;
  date?: string;
}

export interface GetDailyDashboardBookingsParams {
  branchId: DashboardBranchParam;
  date?: string;
  kpi: DailyDashboardKpi;
}

function isValidBranchParam(value: DashboardBranchParam | null | undefined): value is DashboardBranchParam {
  return value === 'all' || (typeof value === 'number' && value > 0);
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  daily: (params?: { branchId?: DashboardBranchParam | null; date?: string | null } | null) =>
    ['dashboard', 'daily', params?.branchId ?? null, params?.date ?? null] as const,
  dailyBookings: (
    params?: {
      branchId?: DashboardBranchParam | null;
      date?: string | null;
      kpi?: DailyDashboardKpi | null;
    } | null,
  ) =>
    [
      'dashboard',
      'daily-bookings',
      params?.branchId ?? null,
      params?.date ?? null,
      params?.kpi ?? null,
    ] as const,
};

// API-40
export async function getDailyDashboard(
  params: GetDailyDashboardParams,
): Promise<DailyDashboardResponse> {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
  });
  if (params.date) {
    search.set('date', params.date);
  }
  const res = await apiFetch<ApiSuccess<DailyDashboardResponse>>(
    `/dashboard/daily?${search.toString()}`,
  );
  return res.data;
}

// API-41
export async function getDailyDashboardBookings(
  params: GetDailyDashboardBookingsParams,
): Promise<DailyDashboardBookingItem[]> {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
    kpi: params.kpi,
  });
  if (params.date) {
    search.set('date', params.date);
  }
  const res = await apiFetch<ApiSuccess<DailyDashboardBookingItem[]>>(
    `/dashboard/daily/bookings?${search.toString()}`,
  );
  return res.data;
}

export function useDailyDashboard(
  params: { branchId?: DashboardBranchParam | null; date?: string | null } | null,
  options?: { enabled?: boolean },
) {
  const hasBranch = isValidBranchParam(params?.branchId);
  return useQuery({
    queryKey: dashboardKeys.daily(params),
    queryFn: () =>
      getDailyDashboard({
        branchId: params!.branchId as DashboardBranchParam,
        date: params?.date ?? undefined,
      }),
    enabled: hasBranch && (options?.enabled ?? true),
  });
}

export function useDailyDashboardBookings(
  params: {
    branchId?: DashboardBranchParam | null;
    date?: string | null;
    kpi?: DailyDashboardKpi | null;
  } | null,
  options?: { enabled?: boolean },
) {
  const hasParams = isValidBranchParam(params?.branchId) && Boolean(params?.kpi);
  return useQuery({
    queryKey: dashboardKeys.dailyBookings(params),
    queryFn: () =>
      getDailyDashboardBookings({
        branchId: params!.branchId as DashboardBranchParam,
        date: params?.date ?? undefined,
        kpi: params!.kpi as DailyDashboardKpi,
      }),
    enabled: hasParams && (options?.enabled ?? true),
  });
}
