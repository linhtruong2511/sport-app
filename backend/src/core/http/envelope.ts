import type { ApiListSuccess, ApiSuccess } from '@sporthub/shared/types';
import type { Clock } from '../clock.js';
import { toIsoVn } from '../time.js';

export interface PaginationInput {
  page: number;
  pageSize: number;
  totalItems: number;
}

export function ok<T>(
  data: T,
  clock: Clock,
  extraMeta?: Record<string, unknown>,
): ApiSuccess<T> {
  return {
    data,
    meta: {
      ...extraMeta,
      serverTime: toIsoVn(clock.now()),
    },
  };
}

export function okList<T>(
  data: T[],
  pagination: PaginationInput,
  clock: Clock,
  extraMeta?: Record<string, unknown>,
): ApiListSuccess<T> {
  const totalPages =
    pagination.pageSize > 0 ? Math.ceil(pagination.totalItems / pagination.pageSize) : 0;

  return {
    data,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems: pagination.totalItems,
      totalPages,
      ...extraMeta,
      serverTime: toIsoVn(clock.now()),
    },
  };
}
