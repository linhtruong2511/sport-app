import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess, SystemSettingDto, SystemSettingKey } from '@sporthub/shared';
import { apiFetch } from './client.ts';

export const adminSettingKeys = {
  all: ['admin-settings'] as const,
};

// R-17 · EXT-05
export async function getAdminSettings(): Promise<SystemSettingDto[]> {
  const res = await apiFetch<ApiSuccess<SystemSettingDto[]>>('/admin/settings');
  return res.data;
}

// R-17 · EXT-06 — chỉ gửi các khóa đã đổi.
export async function updateAdminSettings(
  values: Partial<Record<SystemSettingKey, number>>,
): Promise<SystemSettingDto[]> {
  const res = await apiFetch<ApiSuccess<SystemSettingDto[]>>('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
  return res.data;
}

export function useAdminSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: adminSettingKeys.all,
    queryFn: getAdminSettings,
    enabled: options?.enabled ?? true,
  });
}
