import { z } from 'zod';

/**
 * Call recordings kept on the LMS server while the lesson is recorded, then
 * sent to YouTube or Google Drive by the server (nothing is stored on the
 * host's computer). Any staff member of the organisation can send a
 * recording — not only the person who recorded it (handover when the host
 * drops out of the lesson).
 */

/** Where a server recording is meant to go. */
export const serverRecordingTargetSchema = z.enum(['youtube', 'drive']);
export type ServerRecordingTarget = z.infer<typeof serverRecordingTargetSchema>;

/** Google Drive folder the recordings go to (created by the LMS, drive.file scope). */
export const RECORDING_DRIVE_FOLDER_NAME = 'Уроки LMS';

export const createServerRecordingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(100),
  /** Default `youtube` (older clients). */
  target: serverRecordingTargetSchema.optional(),
});
export type CreateServerRecordingDto = z.infer<typeof createServerRecordingSchema>;

export const sendRecordingToYoutubeSchema = z.object({
  /** A Google access token with the youtube.upload scope, used only for this upload. */
  accessToken: z.string().min(10).max(4096),
});
export type SendRecordingToYoutubeDto = z.infer<typeof sendRecordingToYoutubeSchema>;

export const sendRecordingToDriveSchema = z.object({
  /** A Google access token with the drive.file scope, used only for this upload. */
  accessToken: z.string().min(10).max(4096),
});
export type SendRecordingToDriveDto = z.infer<typeof sendRecordingToDriveSchema>;

export type ServerRecordingStatus =
  /** Pieces are still arriving. */
  | 'recording'
  /** Complete on the server (or the recorder went silent), waiting to be sent (needs a Google sign-in). */
  | 'ready'
  /** The server is sending it to YouTube / Drive. */
  | 'uploading'
  /** On YouTube / Drive; the server copy is kept a few more days. */
  | 'done'
  /** YouTube / Drive refused it (see `error`); the server copy is kept. */
  | 'failed';

export interface ServerRecording {
  id: string;
  sessionId: string;
  title: string;
  mimeType: string;
  bytes: number;
  status: ServerRecordingStatus;
  /** Where it goes (older recordings: youtube). */
  target: ServerRecordingTarget;
  /** 1 for the first recording of a session, 2+ for continuations («часть 2»). */
  part: number;
  /** The recorder stopped sending pieces without finishing (host dropped out). */
  stale?: boolean;
  /** 0..1 while uploading. */
  progress?: number;
  youtubeId?: string;
  driveFileId?: string;
  /** Where to open the finished video (YouTube or Google Drive). */
  link?: string;
  privacy?: string;
  error?: string;
  /** The server still holds the video file (download / send again). */
  fileKept?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Largest single piece the browser sends. */
export const SERVER_RECORDING_PIECE_MAX_BYTES = 32 * 1024 * 1024;
/** A recording whose pieces stopped arriving this long ago can be sent by anyone in the org. */
export const SERVER_RECORDING_STALE_MS = 3 * 60_000;
