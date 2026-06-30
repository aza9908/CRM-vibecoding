'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionListItem, SessionReport } from '@lms/shared';
import { api, API_URL, ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import { getAccessToken } from '@/lib/store/auth-store';

/**
 * Teacher reports (docs/09 §3-5). All shapes come pre-aggregated from the API —
 * the frontend only renders. INPUT contract types live in @lms/shared.
 */

/**
 * The detail endpoint returns the frozen `SessionReport` plus the per-block
 * metric aggregates used by the "Метрики"/"Рейтинги" tabs. Those metric arrays
 * are optional so the page degrades gracefully if the API omits them.
 */
export type SessionReportResponse = SessionReport;

/** GET /lessons/:id/sessions — list of a lesson's sessions with counters. */
export function useLessonSessions(lessonId: string | undefined) {
  return useQuery({
    queryKey: lessonId
      ? queryKeys.lessonSessions(lessonId)
      : queryKeys.lessons,
    queryFn: () =>
      api.get<SessionListItem[]>(`/lessons/${lessonId}/sessions`),
    enabled: !!lessonId,
  });
}

/** GET /sessions/:id/report — full per-student / per-block report + metrics. */
export function useSessionReport(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionId
      ? queryKeys.sessionReport(sessionId)
      : queryKeys.lessons,
    queryFn: () =>
      api.get<SessionReportResponse>(`/sessions/${sessionId}/report`),
    enabled: !!sessionId,
  });
}

/** Pull a filename out of a Content-Disposition header, if present. */
function filenameFromDisposition(
  disposition: string | null,
  fallback: string,
): string {
  if (!disposition) return fallback;
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
}

/**
 * Trigger a browser download of `GET /reports/export?lessonId=&format=`.
 *
 * The export returns a file (CSV/JSON), not JSON the React Query cache should
 * hold — so this is an imperative fetch (with the access token attached) that
 * streams the body into a Blob and clicks a temporary anchor. The refresh
 * client wrapper is intentionally bypassed because we need the raw response.
 */
export async function downloadReportExport(
  lessonId: string,
  format: 'csv' | 'json' = 'csv',
): Promise<void> {
  const token = getAccessToken();
  const url = `${API_URL}/reports/export?lessonId=${encodeURIComponent(
    lessonId,
  )}&format=${format}`;

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!res.ok) {
    throw new ApiError(res.status, `Export failed (${res.status})`);
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get('Content-Disposition'),
    `report-${lessonId}.${format}`,
  );

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
