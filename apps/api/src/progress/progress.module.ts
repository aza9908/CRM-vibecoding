import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ActivityService } from './activity.service';
import { NotesService } from './notes.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

/**
 * Progress + notes feature module (docs/08 — right panel & progress).
 *
 * Owns `PUT /lessons/:id/progress` (student lesson-summary roll-up) and the
 * `GET`/`PUT /lessons/:id/notes` pair.
 *
 * Exports `ActivityService` — the shared `activity_logs` writer — so other
 * modules can record analytics events (the sessions flow logs `session_join`
 * for authenticated participants). `AuthModule` is imported so the controller's
 * guards resolve; `DRIZZLE` comes from the global `DbModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProgressController],
  providers: [ProgressService, NotesService, ActivityService],
  exports: [ActivityService],
})
export class ProgressModule {}
