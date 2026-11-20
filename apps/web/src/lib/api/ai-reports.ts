'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiReportLocale,
  AnswersAnalysis,
  CuratorReportRecord,
  CuratorReportsResponse,
} from '@lms/shared';
import { api } from '@/lib/api/client';

/**
 * «ИИ-анализ ответов» and «ИИ-куратор» — client side. Both are background
 * jobs on the server (like «ИИ-разбор урока»): start returns the job, the
 * queries poll every 4 s while it runs.
 */

const isRunning = (a: { status: string } | null | undefined) =>
  !!a && (a.status === 'queued' || a.status === 'processing');

const toLocale = (locale: string): AiReportLocale =>
  (['ru', 'uz', 'kk', 'en'] as const).find((l) => l === locale) ?? 'ru';

const answersKey = (sessionId: string | undefined) => ['sessions', sessionId, 'answers-analysis'] as const;
const curatorKey = (category: string | null) => ['curator', 'reports', category ?? ''] as const;

/** GET /sessions/:id/answers-analysis — the latest analysis or null. */
export function useAnswersAnalysis(sessionId: string | undefined) {
  return useQuery({
    queryKey: answersKey(sessionId),
    queryFn: async () =>
      (await api.get<{ analysis: AnswersAnalysis | null }>(`/sessions/${sessionId}/answers-analysis`))
        .analysis,
    enabled: !!sessionId,
    refetchInterval: (query) => (isRunning(query.state.data) ? 4_000 : false),
    staleTime: 2_000,
    retry: 1,
  });
}

/** POST /sessions/:id/answers-analysis — start (the running one is returned as is). */
export function useStartAnswersAnalysis(sessionId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: string) =>
      api.post<AnswersAnalysis>(`/sessions/${sessionId}/answers-analysis`, {
        locale: toLocale(locale),
      }),
    onSuccess: (analysis) => qc.setQueryData(answersKey(sessionId), analysis),
  });
}

/** GET /curator/reports — company tiles + the chosen company's latest report. */
export function useCuratorReports(category: string | null) {
  return useQuery({
    queryKey: curatorKey(category),
    queryFn: () => {
      const qs = category ? `?${new URLSearchParams({ category }).toString()}` : '';
      return api.get<CuratorReportsResponse>(`/curator/reports${qs}`);
    },
    placeholderData: (prev) => (prev ? { ...prev, report: null } : prev),
    refetchInterval: (query) => (isRunning(query.state.data?.report) ? 4_000 : false),
    staleTime: 2_000,
    retry: 1,
  });
}

/** POST /curator/reports — start the company's report. */
export function useStartCuratorReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { category: string; locale: string }) =>
      api.post<CuratorReportRecord>('/curator/reports', {
        category: input.category,
        locale: toLocale(input.locale),
      }),
    onSuccess: (report) =>
      qc.setQueryData<CuratorReportsResponse>(curatorKey(report.category), (prev) =>
        prev ? { ...prev, report } : { categories: [], report },
      ),
  });
}
