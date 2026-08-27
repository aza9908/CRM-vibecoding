'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CourseDto,
  CreateModuleDto,
  ModuleDto,
  UpdateModuleDto,
  UpsertCourseDto,
} from '@lms/shared';
import type { Lesson } from '@/lib/api/types';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Program-of-study management (teacher/admin). Read access stays on
 * `useCurriculum()` — these mutations just invalidate that query on success
 * so the tree re-fetches with the change applied.
 */
export function useUpsertCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpsertCourseDto) =>
      api.post<CourseDto>('/program/course', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.curriculum }),
  });
}

/** POST /program/modules — append a new module (auto-creates the course). */
export function useCreateModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateModuleDto) =>
      api.post<ModuleDto>('/program/modules', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.curriculum }),
  });
}

/** PATCH /program/modules/:id. */
export function useUpdateModule(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateModuleDto) =>
      api.patch<ModuleDto>(`/program/modules/${id}`, dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.curriculum }),
  });
}

/** DELETE /program/modules/:id. */
export function useDeleteModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ id: string }>(`/program/modules/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.curriculum }),
  });
}

/** PUT /program/modules/order — reorder the org's modules (drag-and-drop). */
export function useReorderModules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (moduleIds: string[]) =>
      api.put<ModuleDto[]>('/program/modules/order', { moduleIds }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.curriculum }),
  });
}

/** PUT /program/modules/:id/lessons/order — reorder lessons within a module. */
export function useReorderLessons(moduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonIds: string[]) =>
      api.put<Lesson[]>(`/program/modules/${moduleId}/lessons/order`, { lessonIds }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.curriculum }),
  });
}
