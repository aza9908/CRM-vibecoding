import { HttpException, Logger } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import type { ChatMessage, LlmProvider } from '../ai/providers/llm-provider.interface';

/**
 * JSON calls to the bound {@link LlmProvider} with the same rules as the
 * «ИИ-разбор урока» job (`analysis.service.ts`): retry rate limits / server
 * errors honouring `retry-after`, pull the JSON object out of the answer,
 * tidy it within the schema's hard limits, validate with the shared zod
 * schema, and send ONE repair turn when the answer does not fit.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry rate limits and server errors, honouring `retry-after`. */
export async function withRetry<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (signal.aborted) throw new Error('aborted');
    try {
      return await run();
    } catch (err) {
      lastError = err;
      // Our own provider saying "not configured" is final.
      if (err instanceof HttpException) throw err;
      const e = err as { status?: number; headers?: Record<string, string> | Headers };
      const status = e?.status;
      const network =
        status === undefined && /connection|network|fetch|socket|ECONN|timeout/i.test(String(err));
      if (!(status === 429 || (typeof status === 'number' && status >= 500) || network)) {
        throw err;
      }
      const header =
        e.headers instanceof Headers ? e.headers.get('retry-after') : e.headers?.['retry-after'];
      const wait = Number(header);
      const ms = Number.isFinite(wait) && wait > 0 ? Math.min(wait, 90) * 1000 : 2_000 * 2 ** attempt;
      await sleep(Math.min(ms, 90_000));
    }
  }
  throw lastError;
}

/** The first `{` … last `}` of an answer, parsed; null when it is not JSON. */
export function extractJson(raw: string): unknown | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Second attempt after an answer that was not valid JSON for the schema. */
export function repairMessages(previous: ChatMessage[], badAnswer: string, problem: string): ChatMessage[] {
  return [
    ...previous,
    { role: 'assistant', content: badAnswer.slice(0, 6_000) },
    {
      role: 'user',
      content: `That answer could not be used: ${problem.slice(0, 500)}
Send the same answer again as ONE valid JSON object in exactly the required shape — no markdown, no comments, no text before or after it.`,
    },
  ];
}

// ── tidy helpers: bring a model answer within the schema's hard limits ──────

export const cut = (v: unknown, n: number): unknown =>
  typeof v === 'string' ? v.trim().slice(0, n) : v;

/** Objects of an array, at most `max`. */
export const objects = (v: unknown, max: number): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    .slice(0, max);

/** Non-empty strings of an array, each cut to `n`, at most `max`. */
export const strings = (v: unknown, max: number, n: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((x) => x.trim().slice(0, n));

export interface AskJsonOptions<T> {
  llm: LlmProvider;
  messages: ChatMessage[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  tidy?: (input: unknown) => unknown;
  maxTokens: number;
  temperature?: number;
  signal: AbortSignal;
  logger: Logger;
  /** For log lines only. */
  what: string;
}

/** Ask for one JSON object; validated result or null after one repair turn. */
export async function askJson<T>(o: AskJsonOptions<T>): Promise<T | null> {
  let current = o.messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await withRetry(
      () =>
        o.llm.complete(current, {
          temperature: o.temperature ?? 0.2,
          maxTokens: o.maxTokens,
          signal: o.signal,
        }),
      o.signal,
    );
    const json = extractJson(raw);
    const parsed = o.schema.safeParse(o.tidy ? o.tidy(json) : json);
    if (parsed.success) return parsed.data;
    const problem = json
      ? parsed.error.issues
          .slice(0, 6)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
      : 'it was not a JSON object';
    o.logger.warn(`${o.what} rejected (attempt ${attempt + 1}): ${problem}`);
    current = repairMessages(o.messages, raw, problem);
  }
  return null;
}

/** Machine-readable failure reason of a job, as the UI translates it. */
export function failureReason(err: unknown, aborted: boolean): string {
  if (aborted) return 'timeout';
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403
    ? 'llm_unauthorized'
    : status === 429
      ? 'llm_rate_limited'
      : status === 503
        ? 'llm_unavailable'
        : `llm_error${status ? `_${status}` : ''}`;
}
