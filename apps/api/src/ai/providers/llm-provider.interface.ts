/**
 * LLM provider abstraction.
 *
 * Every LLM call in the API goes through this interface so the concrete
 * vendor (Groq today, Claude/OpenAI tomorrow) is swappable by changing only
 * the binding in `ai.module.ts` — controllers and services never touch a
 * vendor SDK directly (CLAUDE.md hard rule #5).
 */

/** A single chat turn in the OpenAI/Groq-compatible message shape. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Optional per-call generation knobs. */
export interface LlmStreamOptions {
  model?: string;
  temperature?: number;
  /** Hard cap on tokens; providers that support it should honour this. */
  maxTokens?: number;
  /** Abort signal so the controller can enforce a stream timeout. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  /**
   * Stream the assistant completion as a sequence of text deltas (tokens).
   * Implementations MUST be async generators so callers can `for await` and
   * forward each delta to the SSE response without buffering the full answer.
   */
  stream(messages: ChatMessage[], opts?: LlmStreamOptions): AsyncIterable<string>;

  /**
   * Non-streaming completion — used where we need the whole answer before
   * acting on it (e.g. AI block generation must parse a full JSON document).
   */
  complete(messages: ChatMessage[], opts?: LlmStreamOptions): Promise<string>;
}

/** DI token for the bound `LlmProvider` implementation. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
