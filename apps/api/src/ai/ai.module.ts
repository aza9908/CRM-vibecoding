import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { LessonsModule } from '../lessons/lessons.module';
import { MaterialsModule } from '../materials/materials.module';
import { StorageModule } from '../storage/storage.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { FileExtractionService } from './file-extraction.service';
import { PdfSlidesService } from './pdf-slides.service';
import { LLM_PROVIDER } from './providers/llm-provider.interface';
import { GroqProvider } from './providers/groq.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { MockLlmProvider } from './providers/mock.provider';

/**
 * AI assistant module — Socratic chat (SSE) and AI workbook generation.
 *
 * - `AuthModule` is imported so the controller's `JwtAuthGuard` / `RolesGuard`
 *   resolve their JWT strategy providers.
 * - `LessonsModule` is imported for `BlocksService`, used to persist
 *   AI-generated blocks.
 * - `StorageModule` is imported for `StorageService.getObjectBuffer`, used by
 *   `POST /lessons/:id/blocks/generate-from-file` to read back an
 *   already-uploaded material before extracting its text.
 * - `MaterialsModule` is imported for `MaterialsService.assertMaterialInOrg`,
 *   the org-scoping check that endpoint runs before reading any file bytes.
 * - The active LLM vendor is chosen here by binding `LLM_PROVIDER`. Swapping to
 *   Claude/OpenAI is a one-line change (`useClass: ClaudeProvider`) — nothing
 *   else in the module depends on a concrete SDK (CLAUDE.md hard rule #5).
 *
 * `ClaudeProvider` is registered as a plain provider (not bound to the token)
 * so it stays compiled and ready to swap in, without being the active provider.
 */
@Module({
  imports: [AuthModule, LessonsModule, MaterialsModule, StorageModule],
  controllers: [AiController],
  providers: [
    AiService,
    FileExtractionService,
    PdfSlidesService,
    ClaudeProvider,
    {
      // Groq in production; the offline mock when it is asked for
      // (`LLM_PROVIDER=mock`) or when there is no key to call Groq with.
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const key = (config.get<string>('GROQ_API_KEY') ?? '').trim();
        const mock = config.get<string>('LLM_PROVIDER') === 'mock' || !key;
        return mock ? new MockLlmProvider() : new GroqProvider(config);
      },
    },
  ],
  // LLM_PROVIDER is exported for the lesson-analysis module (transcription
  // + report), which must go through the same vendor abstraction.
  exports: [AiService, LLM_PROVIDER],
})
export class AiModule {}
