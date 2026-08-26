import { z } from 'zod';

/**
 * AI-assistant DTOs.
 *
 * `chatMessageSchema` mirrors the OpenAI/Groq chat message shape and is reused
 * for the persisted history in `ai_chats.messages`.
 */

/** One chat turn (system / user / assistant). */
export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Body for `POST /ai/chat` (SSE response). */
export const chatSchema = z.object({
  lessonId: z.string().uuid().optional(),
  userMessage: z.string().min(1),
  blockContent: z.string().optional(),
  taskContext: z.string().optional(),
  history: z.array(chatMessageSchema).default([]),
});
export type ChatDto = z.infer<typeof chatSchema>;

/** Body for `POST /lessons/:id/blocks/generate` — AI block generation. */
export const generateBlocksSchema = z.object({
  topic: z.string().min(1),
});
export type GenerateBlocksDto = z.infer<typeof generateBlocksSchema>;

/**
 * Body for `POST /lessons/:id/blocks/generate-from-file` — AI block
 * generation from an already-uploaded material. `materialId` (not a raw
 * storage key) so the server resolves it through the same org-scoped
 * `MaterialsService.assertMaterialInOrg` check every other material read
 * goes through — a raw storage key would let the caller's org be bypassed.
 * The teacher's file is uploaded via the existing materials upload flow
 * (`useUploadMaterialFile` → `POST /materials`) before this call.
 */
export const generateBlocksFromFileSchema = z.object({
  materialId: z.string().uuid(),
});
export type GenerateBlocksFromFileDto = z.infer<
  typeof generateBlocksFromFileSchema
>;
