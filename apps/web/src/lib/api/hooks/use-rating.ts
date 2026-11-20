'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  MyStudentRatingResponse,
  SessionStudentRatingResponse,
  StudentRatingPeriod,
  StudentRatingResponse,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/** GET /rating — staff table of the organization (optionally one company). */
export function useStudentRating(category: string | null, period: StudentRatingPeriod) {
  return useQuery({
    queryKey: queryKeys.rating(category, period),
    queryFn: () => {
      const qs = new URLSearchParams({ period });
      if (category) qs.set('category', category);
      return api.get<StudentRatingResponse>(`/rating?${qs.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

/** GET /rating/me — the logged-in student's points, place and the top 10. */
export function useMyStudentRating(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myRating,
    queryFn: () => api.get<MyStudentRatingResponse>('/rating/me'),
    enabled,
  });
}

/**
 * GET /sessions/:id/rating — the live lesson's company top 10 and the
 * caller's own points. Light polling (once a minute), no WS.
 */
export function useSessionStudentRating(
  sessionId: string | undefined,
  opts?: { participant?: boolean; enabled?: boolean },
) {
  return useQuery({
    queryKey: sessionId ? queryKeys.sessionRating(sessionId) : ['rating', 'session', 'none'],
    queryFn: () =>
      api.get<SessionStudentRatingResponse>(`/sessions/${sessionId}/rating`, {
        participant: opts?.participant,
      }),
    enabled: !!sessionId && (opts?.enabled ?? true),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
