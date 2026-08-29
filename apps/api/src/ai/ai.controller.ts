import {
  BadRequestException,
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
  generateBlocksFromFileSchema,
  generateBlocksSchema,
  type ChatDto,
  type GenerateBlocksDto,
  type GenerateBlocksFromFileDto,
  type AuthUserPayload,
  type ParticipantPayload,
} from '@lms/shared';

import { ZodBody } from '../common/zod-body.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { BlocksService } from '../lessons/blocks.service';
import { MaterialsService } from '../materials/materials.service';
import { StorageService } from '../storage/storage.service';
import { AiService, type PromptRole } from './ai.service';
import { FileExtractionService } from './file-extraction.service';
import {
  LLM_PROVIDER,
  type LlmProvider,
} from './providers/llm-provider.interface';

/** Hard cap on a single chat stream so a stuck upstream can't hang a socket. */
const STREAM_TIMEOUT_MS = 30_000;

type ChatCaller = AuthUserPayload | ParticipantPayload;

function isUser(p: ChatCaller): p is AuthUserPayload {
  return p.aud === 'user';
}

@Controller()
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly ai: AiService,
    private readonly blocks: BlocksService,
    private readonly storage: StorageService,
    private readonly fileExtraction: FileExtractionService,
    private readonly materials: MaterialsService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * `POST /ai/chat` — Socratic assistant, streamed over SSE.
   *
   * Accepts either a logged-in user JWT or a live-session participant JWT so
   * code-join students can use the tutor during a workshop. Participant turns
   * are not persisted (ai_chats.userId FK is users only).
   */
  @Post('ai/chat')
  @UseGuards(UserOrParticipantGuard)
  async chat(
    @CurrentUser() caller: ChatCaller,
    @ZodBody(chatSchema) dto: ChatDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const role: PromptRole =
      isUser(caller) && caller.role === 'teacher' ? 'teacher' : 'student';

    const messages = await this.ai.buildMessages({
      role,
      userMessage: dto.userMessage,
      blockContent: dto.blockContent,
      taskContext: dto.taskContext,
      history: dto.history,
    });

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), STREAM_TIMEOUT_MS);
    res.on('close', () => abort.abort());

    let full = '';
    try {
      for await (const token of this.llm.stream(messages, {
        signal: abort.signal,
      })) {
        full += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }

      if (isUser(caller)) {
        await this.ai.persistChat(caller.sub, dto.lessonId, dto.userMessage, full);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      const aborted = abort.signal.aborted;
      this.logger.warn(
        `Chat stream ${aborted ? 'aborted (timeout/disconnect)' : 'failed'}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (full.length > 0 && isUser(caller)) {
        await this.ai
          .persistChat(caller.sub, dto.lessonId, dto.userMessage, full)
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
   */
  @Post('lessons/:id/blocks/generate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async generate(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) lessonId: string,
    @ZodBody(generateBlocksSchema) dto: GenerateBlocksDto,
  ): Promise<unknown> {
    const blocks = await this.ai.generateBlocks(dto.topic);
    // `appendBlocks`, not `saveBlocks`: AI-generated blocks never carry an
    // `id` (the model is instructed not to emit one), and `saveBlocks`
    // treats "no incoming ids" as "this is the full lesson, delete
    // anything else" — correct for the editor's own Publish (which always
    // sends the complete current list) but not for this endpoint, whose
    // client-side contract (`EditorView.onAiGenerated`) has always been
    // "append these new blocks to what's already there." A lesson that
    // already has hand-authored content must not be silently wiped just
    // because a teacher asked to generate more.
    return this.blocks.appendBlocks(user.orgId, lessonId, blocks);
  }

  /**
   * `POST /lessons/:id/blocks/generate-from-file` — teacher uploads a
   * material (PDF/DOCX/TXT/MD, via the existing materials upload flow) and
   * gets it turned into a full block-based lesson. Lands through the SAME
   * `appendBlocks` path as topic-based generation, so the result opens
   * directly in the already-built drag-and-drop editor for review before
   * publishing — this endpoint never touches a lesson's existing content.
   *
   * Takes a `materialId`, not a raw storage key: `MaterialsService.assertMaterialInOrg`
   * is the SAME org-scoping check every other material read in the app goes
   * through, so a teacher can never read another org's uploaded file through
   * this path (a raw client-supplied storage key would bypass that check
   * entirely — the codebase's stated main security risk).
   */
  @Post('lessons/:id/blocks/generate-from-file')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async generateFromFile(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) lessonId: string,
    @ZodBody(generateBlocksFromFileSchema) dto: GenerateBlocksFromFileDto,
  ): Promise<unknown> {
    const material = await this.materials.assertMaterialInOrg(
      dto.materialId,
      user.orgId,
    );
    if (material.type !== 'file') {
      throw new BadRequestException('material_not_a_file');
    }
    const buffer = await this.storage.getObjectBuffer(material.url);
    const text = await this.fileExtraction.extractText(
      buffer,
      contentTypeFromFilename(material.title),
    );
    // Falls back to a plain, non-AI transcription of the file's text if the
    // LLM call fails, instead of leaving the teacher with only an error —
    // an editable lesson (even if it needs manual cleanup) is always more
    // useful than nothing, and the fallback is easy to spot and fix in the
    // editor (plain text blocks tagged generatedBy:'extracted', badged
    // "From file (no AI)" — see SortableBlock). Both branches persist via
    // `appendBlocks`, never `saveBlocks` — see the comment on `generate`
    // above for why: neither a successful nor a failed generation may wipe
    // a lesson's existing content.
    let blocks;
    try {
      blocks = await this.ai.generateBlocksFromText(text);
    } catch (err) {
      // error, not warn: a 200 response here hides the failure from the
      // teacher (they see plain-text blocks, not an error) — this is the
      // only signal that AI generation is actually broken (misconfigured
      // key, provider outage, ...), and it must be loud enough to alert on.
      this.logger.error(
        `AI block generation failed, falling back to raw text blocks: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      blocks = this.ai.buildRawTextBlocks(text);
    }
    // Not `return`ed from inside the `try`: a rejection from a `return`ed
    // (un-awaited) promise does not run the enclosing `catch` — it would
    // propagate straight past it — so a persistence failure here (a DB
    // problem, unrelated to the AI call) must stay outside the try/catch
    // to surface as a normal error instead of silently vanishing.
    return this.blocks.appendBlocks(user.orgId, lessonId, blocks);
  }
}

/** Best-effort MIME guess from a filename extension, for a material row that
 * (like every `course_materials` row) has no stored content-type column. */
function contentTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}
