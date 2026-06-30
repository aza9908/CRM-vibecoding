import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  BadGatewayException,
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
    const messages: ChatMessage[] = [
      { role: 'system', content: this.blockGenerationSystemPrompt() },
      {
        role: 'user',
        content: `Тема урока: ${topic}\n\nВерни JSON-массив блоков по описанной схеме.`,
      },
    ];

    const raw = await this.llm.complete(messages, { temperature: 0.3 });
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
