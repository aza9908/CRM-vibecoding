import type { ServerRecording, ServerRecordingTarget } from '@lms/shared';
import { getAccessToken } from '@/lib/store/auth-store';
import { api, API_URL, ApiError, refreshAccessToken } from '@/lib/api/client';

/** Call recordings kept on the LMS server until they are on YouTube / Google Drive. */
export const serverRecordings = {
  create: (sessionId: string, title: string, mimeType: string, target: ServerRecordingTarget) =>
    api.post<ServerRecording>(`/sessions/${sessionId}/recordings`, { title, mimeType, target }),
  /** The rest of a recording that was sent while its recorder was offline. */
  continueAfter: (id: string) => api.post<ServerRecording>(`/recordings/${id}/continue`),
  complete: (id: string) => api.post<ServerRecording>(`/recordings/${id}/complete`),
  get: (id: string) => api.get<ServerRecording>(`/recordings/${id}`),
  pending: () => api.get<ServerRecording[]>('/recordings/pending'),
  sendToYoutube: (id: string, accessToken: string) =>
    api.post<ServerRecording>(`/recordings/${id}/youtube`, { accessToken }),
  sendToDrive: (id: string, accessToken: string) =>
    api.post<ServerRecording>(`/recordings/${id}/drive`, { accessToken }),
  send: (id: string, target: ServerRecordingTarget, accessToken: string) =>
    target === 'drive'
      ? serverRecordings.sendToDrive(id, accessToken)
      : serverRecordings.sendToYoutube(id, accessToken),
  remove: (id: string) => api.del<void>(`/recordings/${id}`),
  /** Start a browser download of the server copy (signed 15-minute link). */
  async download(id: string): Promise<void> {
    const { path } = await api.post<{ path: string }>(`/recordings/${id}/download-link`);
    window.location.assign(`${API_URL}${path}`);
  },

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
