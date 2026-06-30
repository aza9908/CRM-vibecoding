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
  code: z.string().length(6),
  name: z.string().min(1),
  userId: z.string().uuid().optional(),
});
export type JoinSessionDto = z.infer<typeof joinSessionSchema>;

/** Result of a successful join: a participant token scoped to the session. */
export type JoinSessionResult = {
  participantToken: string;
  sessionId: string;
  participantId: string;
};
