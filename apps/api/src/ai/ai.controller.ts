import {
  Controller,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  chatSchema,
  generateBlocksSchema,
  type ChatDto,
  type GenerateBlocksDto,
  type AuthUserPayload,
} from '@lms/shared';

import { ZodBody } from '../common/zod-body.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BlocksService } from '../lessons/blocks.service';
import { AiService, type PromptRole } from './ai.service';
import {
  LLM_PROVIDER,
  type LlmProvider,
} from './providers/llm-provider.interface';

/** Hard cap on a single chat stream so a stuck upstream can't hang a socket. */
const STREAM_TIMEOUT_MS = 30_000;

@Controller()
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: AiService,
    private readonly blocks: BlocksService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * `POST /ai/chat` — Socratic assistant, streamed over SSE.
   *
   * Manual SSE (not Nest `@Sse`) because we need to persist the full answer
   * after the stream completes and emit a terminal `[DONE]` sentinel. Guarded
   * by `JwtAuthGuard`: only authenticated Users (students/teachers) can chat.
   */
  @Post('ai/chat')
  @UseGuards(JwtAuthGuard)
  async chat(
    @CurrentUser() user: AuthUserPayload,
    @ZodBody(chatSchema) dto: ChatDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const role: PromptRole = user.role === 'teacher' ? 'teacher' : 'student';

    const messages = await this.ai.buildMessages({
      role,
      userMessage: dto.userMessage,
      blockContent: dto.blockContent,
      taskContext: dto.taskContext,
      history: dto.history,
    });

    // 30s safeguard: abort the upstream stream and close the SSE connection.
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), STREAM_TIMEOUT_MS);

    // If the client disconnects, stop pulling tokens from the provider.
    res.on('close', () => abort.abort());

    let full = '';
    try {
      for await (const token of this.llm.stream(messages, {
        signal: abort.signal,
      })) {
        full += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }

      // Persist the completed turn before signalling completion.
      await this.ai.persistChat(user.sub, dto.lessonId, dto.userMessage, full);
      res.write('data: [DONE]\n\n');
    } catch (err) {
      const aborted = abort.signal.aborted;
      this.logger.warn(
        `Chat stream ${aborted ? 'aborted (timeout/disconnect)' : 'failed'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Best-effort: persist whatever was generated so history isn't lost.
      if (full.length > 0) {
        await this.ai
          .persistChat(user.sub, dto.lessonId, dto.userMessage, full)
          .catch(() => undefined);
      }
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ error: 'stream_failed' })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
      }
    } finally {
      clearTimeout(timeout);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  /**
   * `POST /lessons/:id/blocks/generate` — teacher-only AI block generation.
   *
   * Generates and zod-validates a workbook draft, then hands it to
   * `BlocksService.saveBlocks(orgId, lessonId, ...)`, which enforces that the
   * lesson belongs to the caller's organization (multi-tenant isolation).
   */
  @Post('lessons/:id/blocks/generate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  async generate(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) lessonId: string,
    @ZodBody(generateBlocksSchema) dto: GenerateBlocksDto,
  ): Promise<unknown> {
    const blocks = await this.ai.generateBlocks(dto.topic);
    return this.blocks.saveBlocks(user.orgId, lessonId, blocks);
  }
}
