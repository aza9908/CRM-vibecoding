'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyCodeDto, CreateCompanyDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Platform-admin-only view spanning every organization — distinct from
 * `use-promo-codes.ts`, which is scoped to the caller's own org. Only an
 * account with `isPlatformAdmin` can reach these routes; everyone else gets
 * a 403 from `PlatformController`.
 */

/** GET /platform/companies — every company + its current active code. */
export function usePlatformCompanies() {
  return useQuery({
    queryKey: queryKeys.platformCompanies,
    queryFn: () => api.get<CompanyCodeDto[]>('/platform/companies'),
  });
}

/** POST /platform/companies — add a company to the catalog and issue its
 * first promo code. The only "create a company" path in the product. */
export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCompanyDto) =>
      api.post<CompanyCodeDto>('/platform/companies', dto),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: queryKeys.platformCompanies }),
  });
}

/** POST /platform/companies/:orgId/promo-codes/regenerate — revoke the
 * current code and issue a fresh one (e.g. it leaked or was lost). */
export function useRegenerateCompanyCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) =>
      api.post(`/platform/companies/${orgId}/promo-codes/regenerate`),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: queryKeys.platformCompanies }),
  });
}
