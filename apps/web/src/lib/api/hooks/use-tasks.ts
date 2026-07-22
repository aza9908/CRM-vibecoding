'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTaskDto, TaskDto, UpdateTaskDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/** Internal Задачи board (Trello/Jira-style), admin only. */
export function useTasks() {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => api.get<TaskDto[]>('/tasks'),
  });
}

/** GET /tasks/meta — whether the Telegram bot is configured (status badge). */
export function useTasksMeta() {
  return useQuery({
    queryKey: [...queryKeys.tasks, 'meta'],
    queryFn: () => api.get<{ telegramConfigured: boolean }>('/tasks/meta'),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTaskDto) => api.post<TaskDto>('/tasks', dto),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tasks }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTaskDto }) =>
      api.patch<TaskDto>(`/tasks/${id}`, dto),
    // Optimistic update so drag-and-drop feels instant instead of snapping
    // back while the request is in flight.
    onMutate: async ({ id, dto }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks });
      const previous = qc.getQueryData<TaskDto[]>(queryKeys.tasks);
      if (previous) {
        qc.setQueryData<TaskDto[]>(
          queryKeys.tasks,
          previous.map((t) => (t.id === id ? { ...t, ...dto } : t)),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.tasks, ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: queryKeys.tasks }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ id: string }>(`/tasks/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tasks }),
  });
}
