'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminUserDto,
  ChangeUserRoleDto,
  ResetPasswordResult,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/** GET /admin/users — every user in the caller's org (admin only). */
export function useAdminUsers() {
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: () => api.get<AdminUserDto[]>('/admin/users'),
  });
}

/** PATCH /admin/users/:id/role — the only way to grant/revoke admin/team_lead. */
export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ChangeUserRoleDto }) =>
      api.patch<AdminUserDto>(`/admin/users/${id}/role`, dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  });
}

/**
 * POST /admin/users/:id/reset-password — generates a new password and
 * returns it in plaintext exactly once (shown to the admin, never persisted
 * client-side beyond the mutation result).
 */
export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ResetPasswordResult>(`/admin/users/${id}/reset-password`),
  });
}
