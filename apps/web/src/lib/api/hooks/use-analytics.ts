'use client';

import { useQuery } from '@tanstack/react-query';
import type { CompanyStats, CompanyUserDetail } from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Company analytics (docs/09 §6). Aggregated server-side and scoped to the
 * caller's org by the API — the dashboard renders the numbers as-is and must
 * never recompute them.
 */

/** GET /analytics/company — org KPIs (total/active/avg/completed). */
export function useCompanyStats() {
  return useQuery({
    queryKey: queryKeys.companyStats,
    queryFn: () => api.get<CompanyStats>('/analytics/company'),
  });
}

/** GET /analytics/company/users/:userId — per-employee drilldown. */
export function useCompanyUser(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? queryKeys.companyUser(userId) : queryKeys.companyStats,
    queryFn: () =>
      api.get<CompanyUserDetail>(`/analytics/company/users/${userId}`),
    enabled: !!userId,
  });
}
