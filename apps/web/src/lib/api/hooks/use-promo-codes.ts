'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePromoCodeDto, PromoCodeDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/** GET /admin/promo-codes — every promo code issued by the caller's org. */
export function usePromoCodes() {
  return useQuery({
    queryKey: queryKeys.promoCodes,
    queryFn: () => api.get<PromoCodeDto[]>('/admin/promo-codes'),
  });
}

/** POST /admin/promo-codes — issue a new code. */
export function useCreatePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePromoCodeDto) =>
      api.post<PromoCodeDto>('/admin/promo-codes', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.promoCodes }),
  });
}

/** PATCH /admin/promo-codes/:id/revoke — deactivate a code. */
export function useRevokePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<{ id: string }>(`/admin/promo-codes/${id}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.promoCodes }),
  });
}

/** DELETE /admin/promo-codes/:id — permanently remove a code. */
export function useDeletePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ id: string }>(`/admin/promo-codes/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.promoCodes }),
  });
}
