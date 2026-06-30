import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { LessonsModule } from '../lessons/lessons.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { LLM_PROVIDER } from './providers/llm-provider.interface';
import { GroqProvider } from './providers/groq.provider';
import { ClaudeProvider } from './providers/claude.provider';

/**
 * AI assistant module — Socratic chat (SSE) and AI workbook generation.
 *
 * - `AuthModule` is imported so the controller's `JwtAuthGuard` / `RolesGuard`
 *   resolve their JWT strategy providers.
 * - `LessonsModule` is imported for `BlocksService`, used to persist
 *   AI-generated blocks.
 * - The active LLM vendor is chosen here by binding `LLM_PROVIDER`. Swapping to
 *   Claude/OpenAI is a one-line change (`useClass: ClaudeProvider`) — nothing
 *   else in the module depends on a concrete SDK (CLAUDE.md hard rule #5).
 *
 * `ClaudeProvider` is registered as a plain provider (not bound to the token)
 * so it stays compiled and ready to swap in, without being the active provider.
 */
@Module({
  imports: [AuthModule, LessonsModule],
  controllers: [AiController],
  providers: [
    AiService,
    ClaudeProvider,
    { provide: LLM_PROVIDER, useClass: GroqProvider },
  ],
  exports: [AiService],
})
export class AiModule {}
