'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateLessonDto,
  UpdateLessonDto,
  SaveBlocksDto,
  BlockDto,
  CurriculumTree,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { Block, Lesson, LessonDetail } from '@/lib/api/types';

/** GET /lessons — lessons of the current org (teacher). */
export function useLessons() {
  return useQuery({
    queryKey: queryKeys.lessons,
    queryFn: () => api.get<Lesson[]>('/lessons'),
  });
}

/** GET /lessons/:id — lesson with blocks + outcomes. */
export function useLesson(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.lesson(id) : queryKeys.lessons,
    queryFn: () => api.get<LessonDetail>(`/lessons/${id}`),
    enabled: !!id,
  });
}

/** POST /lessons — create a lesson. */
export function useCreateLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateLessonDto) => api.post<Lesson>('/lessons', dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.lessons });
      void qc.invalidateQueries({ queryKey: queryKeys.curriculum });
    },
  });
}

/** PATCH /lessons/:id — rename / move a lesson. */
export function useUpdateLesson(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateLessonDto) =>
      api.patch<Lesson>(`/lessons/${id}`, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.lessons });
      void qc.invalidateQueries({ queryKey: queryKeys.lesson(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.curriculum });
    },
  });
}

/** DELETE /lessons/:id. */
export function useDeleteLesson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/lessons/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.lessons });
      void qc.invalidateQueries({ queryKey: queryKeys.curriculum });
    },
  });
}

/**
 * PUT /lessons/:id/blocks — bulk save (the editor "Publish").
 * The server upserts the incoming blocks and deletes orphans; order is the
 * array order. Returns the persisted blocks.
 */
export function useSaveBlocks(lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blocks: BlockDto[]) => {
      const payload: SaveBlocksDto = { blocks };
      return api.put<Block[]>(`/lessons/${lessonId}/blocks`, payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.lesson(lessonId) });
    },
  });
}

/** POST /lessons/:id/blocks/generate — AI-generate blocks from a topic. */
export function useGenerateBlocks(lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topic: string) =>
      api.post<Block[]>(`/lessons/${lessonId}/blocks/generate`, { topic }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.lesson(lessonId) });
    },
  });
}

/** GET /curriculum — module/lesson tree (with per-lesson progress for students). */
export function useCurriculum() {
  return useQuery({
    queryKey: queryKeys.curriculum,
    queryFn: () => api.get<CurriculumTree>('/curriculum'),
  });
}
