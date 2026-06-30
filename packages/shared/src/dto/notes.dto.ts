import { z } from 'zod';

/**
 * Lesson-notes DTOs (docs/08).
 *
 * A student keeps free-form notes per lesson (auto-saved). One row per
 * (userId, lessonId); `content` may be empty.
 */

/** Body for saving notes (`PUT /lessons/:id/notes`). */
export const saveNotesSchema = z.object({
  content: z.string(),
});
export type SaveNotesDto = z.infer<typeof saveNotesSchema>;

/** A note row as returned by the API. */
export type NoteDto = {
  id: string;
  userId: string;
  lessonId: string;
  content: string;
  updatedAt: string;
};
