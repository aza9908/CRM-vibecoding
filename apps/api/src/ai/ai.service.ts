import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  BadGatewayException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { blockSchema, type BlockDto, type ChatMessage } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { aiChats } from '../db/schema';
import {
  LLM_PROVIDER,
  type LlmProvider,
} from './providers/llm-provider.interface';

/** Cap on a single (non-streaming) block-generation LLM call — generous
 * compared to the chat stream's 30s (a reasoning model producing a full
 * lesson's JSON takes longer than a first streamed token), but still finite
 * so a stalled provider request fails instead of hanging the request. */
const BLOCK_GENERATION_TIMEOUT_MS = 60_000;

/** Roles that have a dedicated system prompt under `prompts/`. */
export type PromptRole = 'student' | 'teacher';

/** Input to {@link AiService.buildMessages}. */
export interface BuildMessagesInput {
  role: PromptRole;
  userMessage: string;
  /** Content of the workbook block the user is working on. */
  blockContent?: string;
  /** The student's current answer / code, or extra lesson context. */
  taskContext?: string;
  /** Prior turns; only the last 10 are kept to bound token cost. */
  history?: ChatMessage[];
}

/** zod schema for the AI-generated workbook: a plain array of blocks. */
const generatedBlocksSchema = z.array(blockSchema);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  /** In-process cache of loaded prompt templates, keyed by role. */
  private readonly promptCache = new Map<PromptRole, string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Build the message array for the LLM: system prompt (with context injected)
   * + a bounded window of history + the new user message.
   */
  async buildMessages(input: BuildMessagesInput): Promise<ChatMessage[]> {
    const template = await this.loadPrompt(input.role);
    const system = template
      .replaceAll('{{BLOCK_CONTENT}}', input.blockContent ?? '')
      .replaceAll('{{TASK_CONTEXT}}', input.taskContext ?? '');

    const history = (input.history ?? []).slice(-10);

    return [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: input.userMessage },
    ];
  }

  /**
   * Append a completed turn (user message + assistant answer) to the user's
   * `ai_chats` row for this lesson, creating the row on first turn.
   *
   * Scoped by `userId` (taken from the JWT by the controller) so a chat row is
   * only ever read/written for its owner — multi-tenant isolation is enforced
   * because `userId` belongs to exactly one organization.
   */
  async persistChat(
    userId: string,
    lessonId: string | undefined,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    const newTurns: ChatMessage[] = [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage },
    ];

    const lessonFilter =
      lessonId === undefined
        ? isNull(aiChats.lessonId)
        : eq(aiChats.lessonId, lessonId);

    const existing = await this.db
      .select({ id: aiChats.id, messages: aiChats.messages })
      .from(aiChats)
      .where(and(eq(aiChats.userId, userId), lessonFilter))
      .orderBy(desc(aiChats.updatedAt))
      .limit(1);

    if (existing.length > 0) {
      const current = this.coerceMessages(existing[0]!.messages);
      await this.db
        .update(aiChats)
        .set({
          messages: [...current, ...newTurns],
          updatedAt: new Date(),
        })
        .where(eq(aiChats.id, existing[0]!.id));
      return;
    }

    await this.db.insert(aiChats).values({
      userId,
      lessonId: lessonId ?? null,
      messages: newTurns,
    });
  }

  /**
   * Ask the LLM to draft a workbook for `topic` and return validated blocks.
   * The model is asked for strict JSON; we extract, parse, then validate the
   * structure with the shared `blockSchema` before it ever reaches the DB.
   */
  async generateBlocks(topic: string): Promise<BlockDto[]> {
    return this.runBlockGeneration(
      `Тема урока: ${topic}\n\nВерни JSON-массив блоков по описанной схеме.`,
    );
  }

  /**
   * Same as {@link generateBlocks}, but from the extracted text of a
   * teacher-uploaded material instead of a topic string (see
   * `FileExtractionService` / `POST /lessons/:id/blocks/generate-from-file`).
   * The excerpt is capped so an oversized document doesn't blow up token cost.
   */
  async generateBlocksFromText(text: string): Promise<BlockDto[]> {
    const MAX_EXCERPT_CHARS = 12_000;
    const excerpt =
      text.length > MAX_EXCERPT_CHARS
        ? `${text.slice(0, MAX_EXCERPT_CHARS)}…`
        : text;
    return this.runBlockGeneration(
      `Материал (текст, извлечённый из загруженного файла):\n\n${excerpt}\n\nПреобразуй его в JSON-массив блоков по описанной схеме.`,
    );
  }

  /**
   * Non-AI fallback for `POST /lessons/:id/blocks/generate-from-file`: turns
   * the extracted file text straight into a sequence of plain `text`
   * blocks, verbatim, split by page (pdf-parse separates pages with a form
   * feed `\f`) or, failing that, by paragraph. Used when the LLM call
   * fails, so an upload still produces an editable lesson instead of only
   * an error — the teacher can always tidy up plain-text blocks by hand,
   * but a hard failure with no editor is a dead end.
   *
   * Bounded the same way `generateBlocksFromText` bounds its AI excerpt
   * (`MAX_CHARS`), plus a hard cap on block count: unlike the AI path,
   * nothing here limits chunk count on its own, and a large upload
   * (multipart uploads allow up to 40MB) could otherwise turn into
   * hundreds of blocks — a slow save and an unusable editor.
   */
  buildRawTextBlocks(text: string): BlockDto[] {
    const MAX_RAW_TEXT_CHARS = 20_000;
    const MAX_BLOCKS = 30;
    const CHUNK_CHARS = 1000;
    const truncated =
      text.length > MAX_RAW_TEXT_CHARS
        ? `${text.slice(0, MAX_RAW_TEXT_CHARS).trim()}…`
        : text;
    // Page breaks (pdf-parse separates pages with a form feed `\f`) are a
    // preferred split point, not a size guarantee — every page still goes
    // through the same ~1000-char paragraph chunking, so one huge page
    // can't become one huge, unwieldy block.
    const pages = truncated
      .split('\f')
      .map((p) => p.trim())
      .filter(Boolean);
    const source = pages.length > 0 ? pages : [truncated];
    let chunks = source.flatMap((page) =>
      this.chunkByParagraph(page, CHUNK_CHARS),
    );
    if (chunks.length > MAX_BLOCKS) {
      // The greedy paragraph packer can produce more chunks than a naive
      // size estimate predicts (a long paragraph starts a new bin even when
      // the current one has slack) — never respond by dropping the excess
      // chunks (that silently deletes the tail of what the teacher
      // uploaded); degrade to an even split of the whole text instead, so
      // the cap holds without losing any content. Page breaks (`\f`) are
      // replaced, not just present in `truncated` — `evenSplit` cuts on
      // spaces, not `\f`, so without this a stray form-feed could land
      // mid-block instead of at a boundary that got trimmed away.
      chunks = this.evenSplit(truncated.replace(/\f/g, '\n\n'), MAX_BLOCKS);
    }
    return chunks.map((content) => ({
      type: 'text',
      content,
      generatedBy: 'extracted',
    }));
  }

  /** Splits `text` into at most `parts` roughly-equal pieces, in order,
   * with nothing dropped — reuses `hardSplit`'s word-boundary cuts (not a
   * blind character slice) so this fallback-of-a-fallback still reads
   * reasonably, even though it's used precisely when the nicer
   * paragraph-aware chunking produced too many pieces. */
  private evenSplit(text: string, parts: number): string[] {
    const size = Math.max(1, Math.ceil(text.length / parts));
    const pieces = this.hardSplit(text, size);
    if (pieces.length <= parts) return pieces;
    // Word-boundary cuts can land a little short of `size` for text with
    // long stretches between spaces, occasionally nudging the count past
    // `parts` — merge the overflow into the last piece rather than
    // dropping it, so the cap holds without losing content.
    return [...pieces.slice(0, parts - 1), pieces.slice(parts - 1).join(' ')];
  }

  /** Groups paragraphs (blank-line separated) into blocks up to ~1000 chars
   * each, so a wall of short lines doesn't become one block per line — and
   * hard-splits any single paragraph that alone exceeds that on its own
   * (e.g. a document authored with no blank lines at all). */
  private chunkByParagraph(text: string, maxChars = 1000): string[] {
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => this.hardSplit(p, maxChars));
    const chunks: string[] = [];
    let buf = '';
    for (const p of paragraphs) {
      if (buf && buf.length + p.length + 2 > maxChars) {
        chunks.push(buf);
        buf = p;
      } else {
        buf = buf ? `${buf}\n\n${p}` : p;
      }
    }
    if (buf) chunks.push(buf);
    return chunks.length ? chunks : [text.trim()];
  }

  /** Splits a single chunk of text into `maxChars`-sized pieces (on a
   * whitespace boundary where possible) so nothing this function returns
   * ever exceeds the cap, regardless of how it's grouped afterward. */
  private hardSplit(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const pieces: string[] = [];
    let rest = text;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
    return pieces;
  }

  /** Shared LLM call + validation for both block-generation entry points. */
  private async runBlockGeneration(userMessage: string): Promise<BlockDto[]> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.blockGenerationSystemPrompt() },
      { role: 'user', content: userMessage },
    ];

    // A stalled (not erroring) provider request would otherwise hang this
    // call indefinitely — no `catch` block runs, so neither the client nor
    // (for generate-from-file) the raw-text fallback ever engages.
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), BLOCK_GENERATION_TIMEOUT_MS);

    let raw: string;
    try {
      raw = await this.llm.complete(messages, {
        temperature: 0.3,
        signal: abort.signal,
      });
    } catch (err) {
      // A provider can throw a deliberate HttpException of its own (e.g.
      // ClaudeProvider's 503 "not configured") — pass those through
      // unchanged, same as `AllExceptionsFilter` does, so a real deployment
      // mistake isn't masked as a generic "try again" outage. Anything else
      // is a raw SDK error (auth failure, rate limit, network fault, ...)
      // that would otherwise surface to the client as an opaque
      // "internal_error" with nothing actionable to fix — log the real
      // cause and return a clear 502 instead.
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(
        `LLM completion failed: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new BadGatewayException('ai_generation_unavailable');
    } finally {
      clearTimeout(timeout);
    }
    const json = this.extractJson(raw);

    const parsed = generatedBlocksSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(
        `AI block generation returned invalid structure: ${parsed.error.message}`,
      );
      throw new BadGatewayException(
        'AI returned blocks that did not match the expected schema.',
      );
    }

    // Force provenance to 'ai' regardless of what the model emitted.
    return parsed.data.map((b) => ({ ...b, generatedBy: 'ai' as const }));
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** Read and cache `prompts/{role}.md`, resilient to src/ vs dist/ layout. */
  private async loadPrompt(role: PromptRole): Promise<string> {
    const cached = this.promptCache.get(role);
    if (cached !== undefined) {
      return cached;
    }

    const file = `${role}.md`;
    const candidates = [
      // Sits next to the compiled service (dist/ai/prompts) if assets are copied.
      path.join(__dirname, 'prompts', file),
      // Fallback to the source tree (works in `nest start` / ts-node dev).
      path.join(process.cwd(), 'src', 'ai', 'prompts', file),
      path.join(process.cwd(), 'apps', 'api', 'src', 'ai', 'prompts', file),
    ];

    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        this.promptCache.set(role, content);
        return content;
      } catch {
        // try next candidate
      }
    }

    throw new Error(`Prompt template not found for role "${role}" (${file}).`);
  }

  /** System prompt that constrains AI block output to the shared schema. */
  private blockGenerationSystemPrompt(): string {
    return [
      'Ты — генератор структуры рабочей тетради для LMS.',
      'Верни СТРОГО JSON-массив блоков и ничего больше — без markdown, без пояснений.',
      'Каждый блок — объект со следующими полями:',
      '- "type": один из "text" | "image" | "input_text" | "input_select" | "input_rating" | "action_button" | "input_file" | "test".',
      '- "content": строка (текст блока или формулировка задания), либо null.',
      '- "options": для "input_select"/"test" — объект вида {"items":[...],"correct":[...]}, иначе можно опустить.',
      '- "blockRole": опционально одна из строк "system" | "agenda" | "intro" | "reflection".',
      'Сделай 5–8 осмысленных блоков: вступление, материал, пара заданий с вводом ответа, тест и блок рефлексии.',
      'Не добавляй поля "id" или "imageUrl" со ссылками на несуществующие файлы.',
      'Ответ — только валидный JSON-массив.',
    ].join('\n');
  }

  /**
   * Extract a JSON value from a model response that may include code fences or
   * surrounding prose.
   */
  private extractJson(raw: string): unknown {
    const trimmed = raw.trim();

    // Strip a ```json ... ``` (or plain ```) fence if present.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1]!.trim() : trimmed;

    try {
      return JSON.parse(body);
    } catch {
      // Last resort: grab the outermost array.
      const start = body.indexOf('[');
      const end = body.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          return JSON.parse(body.slice(start, end + 1));
        } catch {
          /* fall through */
        }
      }
      throw new BadGatewayException('AI did not return parseable JSON.');
    }
  }

  /** Defensive coercion of the persisted `messages` JSONB into ChatMessage[]. */
  private coerceMessages(value: unknown): ChatMessage[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (m): m is ChatMessage =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as { role?: unknown }).role === 'string' &&
        typeof (m as { content?: unknown }).content === 'string',
    );
  }
}
