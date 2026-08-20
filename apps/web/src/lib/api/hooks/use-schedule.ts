'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateScheduleEventDto,
  ScheduleEventDto,
  ScheduleTimelineDto,
  UpdateScheduleEventDto,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * GET /schedule — the company's whole program in chronological order.
 * Readable by any authenticated user; this is what личный кабинет renders.
 */
export function useSchedule(enabled = true) {
  return useQuery({
    queryKey: queryKeys.schedule,
    enabled,
    queryFn: () => api.get<ScheduleTimelineDto>('/schedule'),
  });
}

/** POST /schedule — admin / curator / methodist only. */
export function useCreateScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateScheduleEventDto) =>
      api.post<ScheduleEventDto>('/schedule', dto),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: queryKeys.schedule }),
  });
}

/** PATCH /schedule/:id. */
export function useUpdateScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateScheduleEventDto }) =>
      api.patch<ScheduleEventDto>(`/schedule/${id}`, dto),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: queryKeys.schedule }),
  });
}

/** DELETE /schedule/:id. */
export function useDeleteScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ id: string }>(`/schedule/${id}`),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: queryKeys.schedule }),
  });
}
