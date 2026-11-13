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

/** Audio handed to {@link LlmProvider.transcribe}. */
export interface TranscribeInput {
  audio: Buffer;
  /** File name with the right extension — vendors sniff the format from it. */
  fileName: string;
  mimeType: string;
  /** ISO-639-1 hint; omit to auto-detect (lessons mix Russian and Uzbek). */
  language?: string;
  signal?: AbortSignal;
}

/** One timed piece of a transcript. */
export interface TranscriptSegment {
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
}

export interface TranscribeResult {
  text: string;
  segments: TranscriptSegment[];
  /** Length of the audio in seconds, when the vendor reports it. */
  durationSec: number | null;
  language: string | null;
}

/** Marker a prompt's system message carries so the mock provider can tell
 * which canned answer a call expects (see `mock.provider.ts`). Real vendors
 * just see it as part of the text. */
export const LLM_TASK_MARKER = {
  analysisNotes: '[[task:lesson-analysis-notes]]',
  analysisReport: '[[task:lesson-analysis-report]]',
} as const;

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

  /**
   * Speech-to-text with segment timestamps — used by the lesson analysis to
   * turn a lesson recording into a timed transcript.
   */
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

/** DI token for the bound `LlmProvider` implementation. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
