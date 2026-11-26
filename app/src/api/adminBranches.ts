import { useQuery } from '@tanstack/react-query';
import type { AdminBranchDto, ApiSuccess, CreateBranchInput } from '@sporthub/shared';
import { catalogKeys } from './catalog.ts';
import { apiFetch } from './client.ts';
import { queryClient } from './queryClient.ts';

export type AdminBranch = AdminBranchDto;

/** Dữ liệu gửi lên — để server zod chuẩn hóa (chuỗi rỗng → null, in hoa, bỏ khoảng trắng STK). */
export type BranchFormInput = {
  [K in keyof CreateBranchInput]: string | null;
};
export type UpdateBranchFormInput = Omit<BranchFormInput, 'code'>;

export const adminBranchKeys = {
  all: ['admin-branches'] as const,
  list: () => ['admin-branches', 'list'] as const,
};

// R-17 · EXT-01
export async function getAdminBranches(): Promise<AdminBranch[]> {
  const res = await apiFetch<ApiSuccess<AdminBranch[]>>('/admin/branches');
  return res.data;
}

// R-17 · EXT-02
export async function createBranch(body: BranchFormInput): Promise<AdminBranch> {
  const res = await apiFetch<ApiSuccess<AdminBranch>>('/admin/branches', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

// R-17 · EXT-03
export async function updateBranch(
  branchId: number,
  body: UpdateBranchFormInput,
): Promise<AdminBranch> {
  const res = await apiFetch<ApiSuccess<AdminBranch>>(`/admin/branches/${branchId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.data;
}

// R-17 · EXT-04
export async function setBranchActive(branchId: number, active: boolean): Promise<AdminBranch> {
  const res = await apiFetch<ApiSuccess<AdminBranch>>(
    `/admin/branches/${branchId}/${active ? 'activate' : 'deactivate'}`,
    { method: 'POST' },
  );
  return res.data;
}

/** Sau khi đổi cơ sở: làm mới cả danh sách quản trị lẫn danh mục công khai (bộ lọc chi nhánh ở sidebar). */
export async function invalidateBranchQueries(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminBranchKeys.all }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
  ]);
}

export function useAdminBranches(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: adminBranchKeys.list(),
    queryFn: getAdminBranches,
    enabled: options?.enabled ?? true,
  });
}
