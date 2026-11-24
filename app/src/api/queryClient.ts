import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
        failureCount < 1,
    },
    mutations: {
      retry: false,
    },
  },
});
