import type { ServerRecording } from '@lms/shared';
import { getAccessToken } from '@/lib/store/auth-store';
import { api, API_URL, ApiError, refreshAccessToken } from '@/lib/api/client';

/** Call recordings kept on the LMS server until they are on YouTube. */
export const serverRecordings = {
  create: (sessionId: string, title: string, mimeType: string) =>
    api.post<ServerRecording>(`/sessions/${sessionId}/recordings`, { title, mimeType }),
  complete: (id: string) => api.post<ServerRecording>(`/recordings/${id}/complete`),
  get: (id: string) => api.get<ServerRecording>(`/recordings/${id}`),
  pending: () => api.get<ServerRecording[]>('/recordings/pending'),
  sendToYoutube: (id: string, accessToken: string) =>
    api.post<ServerRecording>(`/recordings/${id}/youtube`, { accessToken }),
  remove: (id: string) => api.del<void>(`/recordings/${id}`),

  /** Raw bytes starting at `offset`; resolves with the size the server has. */
  async putPiece(id: string, offset: number, piece: Blob): Promise<{ size: number }> {
    const send = (token: string | null) =>
      fetch(`${API_URL}/recordings/${id}/pieces?offset=${offset}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: piece,
      });
    let res = await send(getAccessToken());
    if (res.status === 401) {
      const fresh = await refreshAccessToken();
      if (fresh) res = await send(fresh);
    }
    const body = (await res.json().catch(() => ({}))) as { size?: number; message?: string };
    if (res.status === 409 && typeof body.size === 'number') {
      throw new PieceGap(body.size, body.message ?? 'gap');
    }
    if (!res.ok) throw new ApiError(res.status, body.message ?? `piece_${res.status}`, body.message, body);
    return { size: body.size ?? offset + piece.size };
  },
};

/** The server has a different size than expected (`size`). */
export class PieceGap extends Error {
  constructor(
    readonly size: number,
    message: string,
  ) {
    super(message);
  }
}
