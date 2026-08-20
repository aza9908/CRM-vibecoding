'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompanyDto,
  CreatePromoCodeDto,
  PromoCodeDto,
  PromoCodeLookup,
  UpdateCompanyDto,
  UpdatePromoCodeDto,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/** GET /admin/company — the caller's own company, headcount and promo codes. */
export function useCompany() {
  return useQuery({
    queryKey: queryKeys.company,
    queryFn: () => api.get<CompanyDto>('/admin/company'),
  });
}

/** PATCH /admin/company — rename the company. */
export function useRenameCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateCompanyDto) =>
      api.patch<CompanyDto>('/admin/company', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.company }),
  });
}

/** POST /admin/company/promo-codes — issue a code people register with. */
export function useCreatePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePromoCodeDto) =>
      api.post<PromoCodeDto>('/admin/company/promo-codes', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.company }),
  });
}

/** PATCH /admin/company/promo-codes/:id — usually to deactivate a code. */
export function useUpdatePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePromoCodeDto }) =>
      api.patch<PromoCodeDto>(`/admin/company/promo-codes/${id}`, dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.company }),
  });
}

/** DELETE /admin/company/promo-codes/:id — refused once the code has been used. */
export function useDeletePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ id: string }>(`/admin/company/promo-codes/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.company }),
  });
}

/**
 * GET /auth/promo-code/:code — public lookup used by the signup form to show
 * which company the account will join. Runs unauthenticated (there is no
 * account yet) and stays idle until a plausible-length code is typed, so we
 * don't fire a request on every keystroke of a 2-character prefix.
 */
export function usePromoCodeLookup(code: string) {
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  return useQuery({
    queryKey: queryKeys.promoCodeLookup(normalized),
    enabled: normalized.length >= 4,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      api.get<PromoCodeLookup>(
        `/auth/promo-code/${encodeURIComponent(normalized)}`,
        { auth: false },
      ),
  });
}
