'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateSessionDto,
  JoinSessionDto,
  JoinSessionResult,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type {
  SessionState,
  SessionParticipant,
  SessionResponse,
  MyResponse,
  LiveSessionSummary,
} from '@/lib/api/types';
import { useAuthStore } from '@/lib/store/auth-store';

/** POST /sessions — teacher starts a live session for a lesson; returns code. */
export function useStartSession() {
  return useMutation({
    mutationFn: (dto: CreateSessionDto) =>
      api.post<SessionState>('/sessions', dto),
  });
}

/**
 * GET /sessions/live — the teacher's currently-running sessions, so the
 * lessons dashboard can surface a "вернуться в live" link after a closed tab.
 * Polled so the indicator clears shortly after a session ends.
 */
export function useLiveSessions() {
  return useQuery({
    queryKey: queryKeys.liveSessions,
    queryFn: () => api.get<LiveSessionSummary[]>('/sessions/live'),
    refetchInterval: 15_000,
  });
}

/**
 * POST /sessions/join — join by code (no account needed).
 * Stores the participant token + sessionId in the auth store on success.
 */
export function useJoinSession() {
  const setParticipant = useAuthStore((s) => s.setParticipant);
  return useMutation({
    mutationFn: (dto: JoinSessionDto) =>
      api.post<JoinSessionResult>('/sessions/join', dto, { auth: false }),
    onSuccess: (data) => {
      setParticipant(data.participantToken, data.sessionId);
    },
  });
}

/**
 * GET /sessions/:id — session state + lesson blocks.
 * Works for both teacher (user token) and participant (participant token).
 */
export function useSession(
  id: string | undefined,
  opts?: { participant?: boolean; pollMs?: number },
) {
  return useQuery({
    queryKey: id ? queryKeys.session(id) : queryKeys.lessons,
    queryFn: () =>
      api.get<SessionState>(`/sessions/${id}`, {
        participant: opts?.participant,
      }),
    enabled: !!id,
    refetchInterval: opts?.pollMs ?? false,
    // Survive cold starts / brief API blips — do NOT drop the live UI.
    retry: 6,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8_000),
    staleTime: 1_000,
    // Keep last good snapshot while a refetch fails (prevents 404 kick).
    placeholderData: (prev) => prev,
  });
}

/** GET /sessions/:id/participants — teacher view (live roster sync). */
export function useSessionParticipants(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.sessionParticipants(id) : queryKeys.lessons,
    queryFn: () =>
      api.get<SessionParticipant[]>(`/sessions/${id}/participants`),
    enabled: !!id,
    refetchInterval: 2_500,
    refetchIntervalInBackground: true,
    staleTime: 1_000,
    placeholderData: (prev) => prev,
    retry: 4,
  });
}

/** GET /sessions/:id/responses — teacher summary of answers (live polling). */
export function useSessionResponses(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.sessionResponses(id) : queryKeys.lessons,
    queryFn: () => api.get<SessionResponse[]>(`/sessions/${id}/responses`),
    enabled: !!id,
    // ~1.5s keeps the board snappy for 15 students without hammering the API.
    refetchInterval: 1_500,
    refetchIntervalInBackground: true,
    staleTime: 800,
    placeholderData: (prev) => prev,
    retry: 4,
  });
}

/**
 * GET /sessions/:id/my-responses — the calling participant's own answers.
 * Seeds the navigation tab's "answered" set on entry so previously answered
 * blocks show as completed. Uses the participant token by default (a guest
 * who joined by code has no other credential); an authenticated user opening
 * a session they never joined via `/join` (e.g. reviewing a past lesson) has
 * no participant token at all, so `opts.participant: false` sends their own
 * user token instead — the API accepts either and maps a user with no
 * participant row for this session to an empty list, not an error.
 */
export function useMyResponses(
  id: string | undefined,
  opts?: { participant?: boolean },
) {
  return useQuery({
    queryKey: id ? queryKeys.myResponses(id) : queryKeys.lessons,
    queryFn: () =>
      api.get<MyResponse[]>(`/sessions/${id}/my-responses`, {
        participant: opts?.participant ?? true,
      }),
    enabled: !!id,
  });
}

/** POST /sessions/:id/end — teacher ends the session. */
export function useEndSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<SessionState>(`/sessions/${sessionId}/end`),
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    },
  });
}
