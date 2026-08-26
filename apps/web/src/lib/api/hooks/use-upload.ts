'use client';

import { useMutation } from '@tanstack/react-query';
import type { PresignDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import type { PresignResult } from '@/lib/api/types';

/**
 * Upload an image for a workbook block.
 * Prefers `POST /uploads` (multipart) so deploys without S3 secrets still work
 * via the API's Postgres fallback. Falls back to presign+PUT when needed.
 */
export function useUploadImage() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const form = new FormData();
      form.append('file', file);
      form.append('scope', 'lesson-media');
      try {
        const uploaded = await api.post<{ publicUrl: string }>('/uploads', form);
        return uploaded.publicUrl;
      } catch {
        const dto: PresignDto = {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        };
        const { uploadUrl, publicUrl } = await api.post<PresignResult>(
          '/uploads/presign',
          dto,
        );

        let put: Response;
        try {
          put = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': dto.contentType },
            body: file,
          });
        } catch {
          throw new Error(
            'upload_network_error: could not reach storage (check S3/API_PUBLIC_URL)',
          );
        }
        if (!put.ok) {
          throw new Error(`upload_failed_${put.status}`);
        }
        return publicUrl;
      }
    },
  });
}
