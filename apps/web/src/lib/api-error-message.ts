import { ApiError } from '@/lib/api/client';

/**
 * Backend error code for any LLM-call failure (auth/rate-limit/timeout/
 * outage — `AiService.runBlockGeneration` maps all of them to this one code
 * so the client never has to distinguish the reason). Shared as a constant,
 * not restated as a string literal in every dialog that calls an AI
 * generation endpoint, so a rename can't update one call site and miss
 * another.
 */
export const AI_GENERATION_UNAVAILABLE_CODE = 'ai_generation_unavailable';

/**
 * First pass at classifying an API failure that's common to every
 * authenticated mutation, before a caller layers its own more specific
 * error codes on top: an expired session (401, `common.sessionExpired`) or
 * the shared AI-unavailable code (`editor.aiGenerationUnavailable`). Returns
 * `null` for anything else, including a non-`ApiError` — the caller should
 * fall back to its own codes, then a generic message.
 */
export function commonApiErrorKey(
  err: unknown,
): 'sessionExpired' | 'aiGenerationUnavailable' | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 401) return 'sessionExpired';
  if (err.code === AI_GENERATION_UNAVAILABLE_CODE) return 'aiGenerationUnavailable';
  return null;
}
