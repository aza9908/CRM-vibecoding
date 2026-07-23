'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ForgotPasswordDto,
  LoginDto,
  MessageResult,
  RegisterDto,
  ResetPasswordDto,
  ResetTokenStatus,
  AuthResult,
  PublicUser,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { MeResponse } from '@/lib/api/types';
import { useAuthStore } from '@/lib/store/auth-store';

/** POST /auth/login — sets access token + user in the store on success. */
export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: LoginDto) => api.post<AuthResult>('/auth/login', dto),
    onSuccess: (data) => {
      setAuth(data.accessToken, data.user);
      qc.setQueryData(queryKeys.me, data.user);
    },
  });
}

/** POST /auth/register — creates org + user, then signs in. */
export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: RegisterDto) =>
      api.post<AuthResult>('/auth/register', dto),
    onSuccess: (data) => {
      setAuth(data.accessToken, data.user);
      qc.setQueryData(queryKeys.me, data.user);
    },
  });
}

/**
 * POST /auth/forgot-password — always resolves, even for unknown addresses.
 * The API deliberately returns the same 202 either way so the UI cannot be
 * used to discover which emails are registered; the success screen is shown
 * unconditionally.
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: (dto: ForgotPasswordDto) =>
      api.post<MessageResult>('/auth/forgot-password', dto),
  });
}

/**
 * GET /auth/reset-password/validate — checks a link before showing the form
 * so an expired token surfaces immediately instead of after typing.
 */
export function useValidateResetToken(token: string | null) {
  return useQuery({
    queryKey: ['auth', 'reset-token', token],
    queryFn: () =>
      api.get<ResetTokenStatus>(
        `/auth/reset-password/validate?token=${encodeURIComponent(token ?? '')}`,
        { auth: false },
      ),
    enabled: !!token,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

/** POST /auth/reset-password — consumes the token and sets the new password. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (dto: ResetPasswordDto) =>
      api.post<MessageResult>('/auth/reset-password', dto),
  });
}

/** GET /auth/me — current user; enabled only when an access token exists. */
export function useMe() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery<MeResponse, Error, PublicUser>({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const me = await api.get<MeResponse>('/auth/me');
      const user: PublicUser = {
        id: me.id,
        email: me.email,
        fullName: me.fullName,
        role: me.role,
        organizationId: me.organizationId,
      };
      setUser(user);
      return user;
    },
    enabled: !!accessToken,
    staleTime: 60_000,
  });
}

/** Clears local auth state. (Refresh cookie is cleared server-side on logout.) */
export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/auth/logout');
      } catch {
        /* logout is best-effort */
      }
    },
    onSettled: () => {
      clear();
      qc.clear();
    },
  });
}
