'use client';

import { useMutation } from '@tanstack/react-query';
import type { PresignDto } from '@lms/shared';
import { api } from '@/lib/api/client';
import type { PresignResult } from '@/lib/api/types';

/**
 * Two-step S3/R2 upload:
 *   1. POST /uploads/presign -> { uploadUrl, publicUrl }
 *   2. PUT the file bytes directly to uploadUrl (bypasses the API).
 * Returns the publicUrl to store in a block's imageUrl.
 */
export function useUploadImage() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const dto: PresignDto = {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
      };
      // Step 1 — ask the API for a presigned PUT URL. If storage isn't
      // configured the API now returns a 503 with a clear message (previously
      // this was an opaque 500), which `api.post` throws as an ApiError.
      const { uploadUrl, publicUrl } = await api.post<PresignResult>(
        '/uploads/presign',
        dto,
      );

      // Step 2 — upload the bytes straight to S3/R2/MinIO. A failure here is
      // usually a bucket CORS rule or an expired signature, not an API bug.
      let put: Response;
      try {
        put = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': dto.contentType },
          body: file,
        });
      } catch {
        throw new Error(
          'upload_network_error: could not reach the storage bucket (check bucket CORS)',
        );
      }
      if (!put.ok) {
        throw new Error(`upload_failed_${put.status}`);
      }
      return publicUrl;
    },
  });
}
