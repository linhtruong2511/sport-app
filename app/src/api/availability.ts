import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess, BlockType } from '@sporthub/shared';
import { apiFetch } from './client.ts';

export type AvailabilityCellState = 'FREE' | 'BOOKED' | 'MINE' | 'HELD' | 'LOCKED' | 'PAST';

export interface AvailabilityCell {
  start: string;
  end: string;
  state: AvailabilityCellState;
  price?: number;
  label?: string;
  blockId?: number;
  blockType?: BlockType;
  reason?: string;
}

export type AvailabilityCourtState = 'READY' | 'MAINTENANCE' | 'DECOMMISSION' | 'INACTIVE';

export interface AvailabilityCourt {
  courtId: number;
  code: string;
  name: string;
  state: AvailabilityCourtState;
  cells: AvailabilityCell[];
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  priceLabel: string;
}

export interface AvailabilityBranchInfo {
  branchId: number;
  name: string;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface AvailabilityHolidayInfo {
  holidayId?: number;
  name: string;
  date?: string;
  note?: string | null;
}

export interface AvailabilityResponse {
  date: string;
  dayOfWeek: number;
  branch: AvailabilityBranchInfo;
  holiday: AvailabilityHolidayInfo | null;
  slotMinutes: number;
  slots: AvailabilitySlot[];
  priceHint: string;
  courts: AvailabilityCourt[];
}

export interface GetAvailabilityParams {
  branchId: number;
  sportId: number;
  date: string;
}

export const availabilityKeys = {
  all: ['availability'] as const,
  grid: (params: Partial<GetAvailabilityParams>) =>
    [
      'availability',
      'grid',
      params.branchId ?? null,
      params.sportId ?? null,
      params.date ?? null,
    ] as const,
};

export async function getAvailabilityApi(
  params: GetAvailabilityParams,
): Promise<AvailabilityResponse> {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
    sportId: String(params.sportId),
    date: params.date,
  });
  const res = await apiFetch<ApiSuccess<AvailabilityResponse>>(`/availability?${search.toString()}`);
  return res.data;
}

export function useAvailability(
  params: {
    branchId?: number | null;
    sportId?: number | null;
    date?: string | null;
  },
  options?: { enabled?: boolean },
) {
  const hasParams =
    typeof params.branchId === 'number' &&
    params.branchId > 0 &&
    typeof params.sportId === 'number' &&
    params.sportId > 0 &&
    typeof params.date === 'string' &&
    params.date.length > 0;

  return useQuery({
    queryKey: availabilityKeys.grid({
      branchId: params.branchId ?? undefined,
      sportId: params.sportId ?? undefined,
      date: params.date ?? undefined,
    }),
    queryFn: () =>
      getAvailabilityApi({
        branchId: params.branchId as number,
        sportId: params.sportId as number,
        date: params.date as string,
      }),
    enabled: hasParams && (options?.enabled ?? true),
  });
}
