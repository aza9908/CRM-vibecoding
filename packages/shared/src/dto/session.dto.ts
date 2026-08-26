import { z } from 'zod';

/**
 * Live-session DTOs.
 *
 * The session code is exactly 6 chars (A-Z0-9, ambiguous chars excluded server-side).
 * `userId` on join is optional: present when a logged-in user joins their own
 * session, absent for a pure guest who entered only a name + code.
 */

/** Body for `POST /sessions` — teacher starts a live session for a lesson. */
export const createSessionSchema = z.object({
  lessonId: z.string().uuid(),
});
export type CreateSessionDto = z.infer<typeof createSessionSchema>;

/** Body for `POST /sessions/join` — enter a live session by code. */
export const joinSessionSchema = z.object({
  // Normalize case; alphabet matches server CODE_ALPHABET (no 0/O/1/I).
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(
      z
        .string()
        .length(6)
        .regex(
          /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/,
          'invalid_session_code',
        ),
    ),
  name: z.string().trim().min(1).max(80),
  userId: z.string().uuid().optional(),
});
export type JoinSessionDto = z.infer<typeof joinSessionSchema>;

/** Body for `POST /sessions/:id/focus` — teacher focuses a workbook block. */
export const setFocusSchema = z.object({
  blockId: z.string().uuid(),
});
export type SetFocusDto = z.infer<typeof setFocusSchema>;

/**
 * Body for `POST /sessions/:id/responses` — participant saves an answer
 * (REST). `completed` is an optional explicit override for the fullscreen
 * slide view's mark-complete checkmark — when omitted, completion is still
 * auto-derived from a non-empty `answerText` (today's behavior, unchanged).
 */
export const saveSessionResponseSchema = z.object({
  blockId: z.string().uuid(),
  answerText: z.string().max(20_000),
  completed: z.boolean().optional(),
});
export type SaveSessionResponseDto = z.infer<typeof saveSessionResponseSchema>;

/**
 * Body for `POST /sessions/:id/responses/upload` (multipart form field
 * alongside `file`) — which `input_file` block the upload answers.
 */
export const uploadResponseFileSchema = z.object({
  blockId: z.string().uuid(),
});
export type UploadResponseFileDto = z.infer<typeof uploadResponseFileSchema>;

/** Body for `POST /sessions/:id/chat` — group chat message (REST). */
export const sendSessionChatSchema = z.object({
  text: z.string().trim().min(1).max(500),
});
export type SendSessionChatDto = z.infer<typeof sendSessionChatSchema>;

/** Result of a successful join: a participant token scoped to the session. */
export type JoinSessionResult = {
  participantToken: string;
  sessionId: string;
  participantId: string;
};
