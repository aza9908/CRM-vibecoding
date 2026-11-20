import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { RatingModule } from '../rating/rating.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AiReportsController } from './ai-reports.controller';
import { AiReportsService } from './ai-reports.service';
import { AnswersAgent } from './answers-agent';
import { CuratorAgent } from './curator-agent';

/**
 * «ИИ-анализ ответов» (per live session) and «ИИ-куратор» (per company):
 * two AI agents on the LMS's own data, with the lesson analysis's job pattern.
 *
 *  - AiModule provides the bound `LLM_PROVIDER` (CLAUDE.md hard rule #5).
 *  - RatingModule provides `RatingService` — the curator's learners are the
 *    rating's students (one person across sessions).
 *  - SessionsModule provides the org-scoping assertion for sessions.
 *  - AuthModule provides the guards' JWT strategy.
 */
@Module({
  imports: [AuthModule, AiModule, SessionsModule, RatingModule],
  controllers: [AiReportsController],
  providers: [AiReportsService, AnswersAgent, CuratorAgent],
})
export class AiReportsModule {}
