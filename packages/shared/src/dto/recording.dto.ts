import { z } from 'zod';

/**
 * Call recordings kept on the LMS server while the lesson is recorded, then
 * sent to YouTube by the server (nothing is stored on the host's computer).
 */
export const createServerRecordingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(100),
});
export type CreateServerRecordingDto = z.infer<typeof createServerRecordingSchema>;

export const sendRecordingToYoutubeSchema = z.object({
  /** A Google access token with the youtube.upload scope, used only for this upload. */
  accessToken: z.string().min(10).max(4096),
});
export type SendRecordingToYoutubeDto = z.infer<typeof sendRecordingToYoutubeSchema>;

export type ServerRecordingStatus =
  /** Pieces are still arriving. */
  | 'recording'
  /** Complete on the server, waiting to be sent (needs the host's Google sign-in). */
  | 'ready'
  /** The server is sending it to YouTube. */
  | 'uploading'
  /** On YouTube; the server copy is deleted. */
  | 'done'
  /** YouTube refused it (see `error`); the server copy is kept. */
  | 'failed';

export interface ServerRecording {
  id: string;
  sessionId: string;
  title: string;
  mimeType: string;
  bytes: number;
  status: ServerRecordingStatus;
  /** 0..1 while uploading to YouTube. */
  progress?: number;
  youtubeId?: string;
  privacy?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Largest single piece the browser sends. */
export const SERVER_RECORDING_PIECE_MAX_BYTES = 32 * 1024 * 1024;
