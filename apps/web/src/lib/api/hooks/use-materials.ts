'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateMaterialDto,
  UpdateMaterialDto,
  MaterialDto,
  LessonMaterial,
  PresignDto,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import type { PresignResult } from '@/lib/api/types';

/**
 * Materials (docs/07). A material is a `file` (private S3 object) or a `link`
 * (external href). Files are uploaded via presign into the `course-materials/`
 * bucket and stored on the material as their S3 **key**; downloads go through
 * `GET /materials/:id/download`, which mints a short-lived presigned GET.
 */

// ── Teacher: full material list + CRUD ────────────────────────────────────

/** GET /materials — all materials of the current org (teacher). */
export function useMaterials() {
  return useQuery({
    queryKey: queryKeys.materials,
    queryFn: () => api.get<MaterialDto[]>('/materials'),
  });
}

/** POST /materials — create a material and attach it to lessons. */
export function useCreateMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateMaterialDto) =>
      api.post<MaterialDto>('/materials', dto),
    onSuccess: (_data, dto) => {
      void qc.invalidateQueries({ queryKey: queryKeys.materials });
      for (const lessonId of dto.lessonIds ?? []) {
        void qc.invalidateQueries({
          queryKey: queryKeys.lessonMaterials(lessonId),
        });
      }
    },
  });
}

/** PATCH /materials/:id — rename / change url / re-attach lessons. */
export function useUpdateMaterial(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateMaterialDto) =>
      api.patch<MaterialDto>(`/materials/${id}`, dto),
    onSuccess: () => {
      // Lesson attachments may have changed, so refresh every lesson list.
      void qc.invalidateQueries({ queryKey: queryKeys.materials });
      void qc.invalidateQueries({ queryKey: ['lessons'] });
    },
  });
}

/** DELETE /materials/:id — remove the material (and its S3 file). */
export function useDeleteMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/materials/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.materials });
      void qc.invalidateQueries({ queryKey: ['lessons'] });
    },
  });
}

// ── Lesson-scoped: materials of one lesson (teacher + participant) ─────────

/**
 * GET /lessons/:id/materials — materials attached to a lesson. Used by the
 * student right-panel tab and the editor attach panel. Reachable by both a
 * logged-in user and a session participant.
 */
export function useLessonMaterials(
  lessonId: string | undefined,
  options?: { participant?: boolean },
) {
  return useQuery({
    queryKey: lessonId
      ? queryKeys.lessonMaterials(lessonId)
      : queryKeys.materials,
    queryFn: () =>
      api.get<LessonMaterial[]>(`/lessons/${lessonId}/materials`, {
        participant: options?.participant,
      }),
    enabled: !!lessonId,
  });
}

// ── Download / open ───────────────────────────────────────────────────────

/**
 * Resolve a material's download target via `GET /materials/:id/download`
 * (presigned GET for files, the raw href for links) and open it in a new tab.
 *
 * `window.open` is called synchronously *after* the await, so some browsers may
 * treat it as a popup; callers invoke this directly from a user click, which
 * keeps it allowed in practice.
 */
export async function openMaterial(
  id: string,
  options?: { participant?: boolean },
): Promise<void> {
  const { url } = await api.get<{ url: string }>(`/materials/${id}/download`, {
    participant: options?.participant,
  });
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Presign + upload helper (file materials) ──────────────────────────────

/**
 * The S3 key prefix for material files (mirrors the API presign route, which
 * keys `course-materials` uploads under this prefix).
 */
const MATERIALS_PREFIX = 'course-materials/';

/**
 * The presign route returns a `publicUrl`, but a material's `url` must be the
 * private S3 **key** (the API mints a presigned GET from it). Recover the key
 * from the public URL by slicing from the `course-materials/` segment.
 */
function keyFromPublicUrl(publicUrl: string): string {
  let path = publicUrl;
  try {
    // Decode %xx escapes so the key matches what the API stored.
    path = decodeURI(publicUrl);
  } catch {
    /* keep the raw string if it is not valid percent-encoding */
  }
  const idx = path.indexOf(MATERIALS_PREFIX);
  return idx >= 0 ? path.slice(idx) : path;
}

export interface UploadedMaterialFile {
  /** S3 key to store as the material's `url`. */
  key: string;
  /** Original filename — handy as a default material title. */
  filename: string;
}

/**
 * Two-step upload of a material file into the private `course-materials` bucket:
 *   1. POST /uploads/presign { scope:'course-materials' } -> { uploadUrl, publicUrl }
 *   2. PUT the bytes straight to uploadUrl.
 * Returns the S3 key to persist via `POST /materials { type:'file', url: key }`.
 */
export function useUploadMaterialFile() {
  return useMutation({
    mutationFn: async (file: File): Promise<UploadedMaterialFile> => {
      const dto: PresignDto = {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        scope: 'course-materials',
      };
      const { uploadUrl, publicUrl } = await api.post<PresignResult>(
        '/uploads/presign',
        dto,
      );

      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': dto.contentType },
        body: file,
      });
      if (!put.ok) {
        throw new Error(`upload_failed_${put.status}`);
      }

      return { key: keyFromPublicUrl(publicUrl), filename: file.name };
    },
  });
}
