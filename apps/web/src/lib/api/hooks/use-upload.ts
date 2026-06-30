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
      return publicUrl;
    },
  });
}
