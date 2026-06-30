'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LessonProgressView, UpdateProgressDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Lesson progress (docs/08 §5). The per-block progress lives on the client in
 * real time, but the **lesson-summary percent** is persisted for curriculum
 * checkmarks and analytics.
 *
 * `PUT /lessons/:id/progress { percent }` upserts one row per (userId, lessonId)
 * for an authenticated student: <100 → in_progress, 100 → completed. Guests
 * (session participants without an account) are intentionally NOT tracked, so
 * callers must only invoke this for logged-in users.
 */
export function useUpdateProgress(lessonId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (percent: number) => {
      const body: UpdateProgressDto = { percent };
      return api.put<LessonProgressView>(`/lessons/${lessonId}/progress`, body);
    },
    onSuccess: (data) => {
      if (!lessonId) return;
      qc.setQueryData(queryKeys.lessonProgress(lessonId), data);
      // The curriculum tree merges per-lesson progress for students; refresh it
      // so completion checkmarks pick up the new percent.
      void qc.invalidateQueries({ queryKey: queryKeys.curriculum });
    },
  });
}
