import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { LessonsModule } from '../lessons/lessons.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

/**
 * «ИИ-разбор урока»: audio intake for recorded lessons and the background job
 * that transcribes them and writes the AI review.
 *
 *  - AiModule provides the bound `LLM_PROVIDER` (transcription + completion go
 *    through the vendor abstraction — CLAUDE.md hard rule #5).
 *  - SessionsModule / LessonsModule provide the org-scoping assertions.
 *  - AuthModule provides the guards' JWT strategy.
 */
@Module({
  imports: [AuthModule, AiModule, SessionsModule, LessonsModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
