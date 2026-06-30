'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoteDto, SaveNotesDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Lesson notes (docs/08). A student keeps free-form notes per lesson, one row
 * per (userId, lessonId), auto-saved from the "Notes" tab.
 *
 * Notes are tied to a logged-in **user**, not a session participant — guests
 * who joined by code have no account to attach notes to, so the Notes tab only
 * uses these hooks when an authenticated user is viewing.
 */

/** GET /lessons/:id/notes — the current user's notes for a lesson. */
export function useLessonNotes(lessonId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: lessonId ? queryKeys.lessonNotes(lessonId) : queryKeys.lessons,
    queryFn: () => api.get<NoteDto>(`/lessons/${lessonId}/notes`),
    enabled: enabled && !!lessonId,
  });
}

/**
 * PUT /lessons/:id/notes — upsert the current user's notes for a lesson.
 * Debouncing lives in the calling component (~600ms); this just persists.
 */
export function useSaveNotes(lessonId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => {
      const body: SaveNotesDto = { content };
      return api.put<NoteDto>(`/lessons/${lessonId}/notes`, body);
    },
    onSuccess: (data) => {
      if (!lessonId) return;
      // Keep the cached note in sync so a remount shows the latest content.
      qc.setQueryData(queryKeys.lessonNotes(lessonId), data);
    },
  });
}
