import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BlocksService } from './blocks.service';
import { CurriculumService } from './curriculum.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

/**
 * Lessons / workbook / curriculum feature module.
 *
 * Exports `LessonsService` and `BlocksService` for cross-module use — in
 * particular the AI module depends on `BlocksService` to persist generated
 * blocks (`POST /lessons/:id/blocks/generate`).
 *
 * `AuthModule` is imported so the controller's guards (`JwtAuthGuard`,
 * `RolesGuard`) and their JWT/strategy providers resolve.
 */
@Module({
  imports: [AuthModule],
  controllers: [LessonsController],
  providers: [LessonsService, BlocksService, CurriculumService],
  exports: [LessonsService, BlocksService],
})
export class LessonsModule {}
