import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess } from '@sporthub/shared';
import { apiFetch } from './client.ts';

export type ReportFilterParam = number | 'all';

export interface GetRevenueReportParams {
  from: string;
  to: string;
  branchId?: ReportFilterParam;
  courtId?: ReportFilterParam;
}

export interface RevenueReportPeriod {
  from: string;
  to: string;
}

export interface RevenueReportRow {
  key: string;
  name: string;
  courtCount: number;
  orders: number;
  completed: number;
  canceled: number;
  expired: number;
  byFacility: number;
  bookedHours: number;
  capacityHours: number;
  occupancyRate: number;
  fromCompleted: number;
  fromUpcoming: number;
  fromCanceled: number;
  grossCollected: number;
  totalRefunded: number;
  netRevenue: number;
  total: number;
  bankTransfer: number;
  cash: number;
}

export interface RevenueReportSummary extends Omit<RevenueReportRow, 'key' | 'name'> {
  completedRate: number;
  canceledRate: number;
  expiredRate: number;
}

export interface RevenueReportPromotionStats {
  orders: number;
  discountTotal: number;
  revenue: number;
}

export interface RevenueReportResponse {
  period: RevenueReportPeriod;
  isEmpty: boolean;
  summary: RevenueReportSummary;
  byBranch: RevenueReportRow[];
  byCourt: RevenueReportRow[];
  promotion: RevenueReportPromotionStats;
}

export const reportsKeys = {
  all: ['reports'] as const,
  revenue: (params?: Partial<GetRevenueReportParams> | null) =>
    ['reports', 'revenue', params ?? {}] as const,
};

// API-66
export async function getRevenueReport(
  params: GetRevenueReportParams,
): Promise<RevenueReportResponse> {
  const search = new URLSearchParams({
    from: params.from,
    to: params.to,
  });
  if (params.branchId === 'all' || typeof params.branchId === 'number') {
    search.set('branchId', String(params.branchId));
  }
  if (params.courtId === 'all' || typeof params.courtId === 'number') {
    search.set('courtId', String(params.courtId));
  }
  const res = await apiFetch<ApiSuccess<RevenueReportResponse>>(
    `/reports/revenue?${search.toString()}`,
  );
  return res.data;
}

export function useRevenueReport(
  params: {
    from?: string | null;
    to?: string | null;
    branchId?: ReportFilterParam | null;
    courtId?: ReportFilterParam | null;
  } | null,
  options?: { enabled?: boolean },
) {
  const hasRange = Boolean(params && params.from && params.to);
  const normalizedParams: Partial<GetRevenueReportParams> | null = hasRange
    ? {
        from: params!.from as string,
        to: params!.to as string,
        branchId: params?.branchId ?? undefined,
        courtId: params?.courtId ?? undefined,
      }
    : null;

  return useQuery({
    queryKey: reportsKeys.revenue(normalizedParams),
    queryFn: () => getRevenueReport(normalizedParams as GetRevenueReportParams),
    enabled: hasRange && (options?.enabled ?? true),
  });
}
