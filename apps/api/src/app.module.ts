import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { LessonsModule } from './lessons/lessons.module';
import { StorageModule } from './storage/storage.module';
import { SessionsModule } from './sessions/sessions.module';
import { ResponsesModule } from './responses/responses.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AiModule } from './ai/ai.module';
import { MaterialsModule } from './materials/materials.module';
import { ProgressModule } from './progress/progress.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ProgramModule } from './program/program.module';
import { AdminModule } from './admin/admin.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    LessonsModule,
    StorageModule,
    SessionsModule,
    ResponsesModule,
    RealtimeModule,
    AiModule,
    MaterialsModule,
    ProgressModule,
    AnalyticsModule,
    ProgramModule,
    AdminModule,
    TasksModule,
  ],
})
export class AppModule {}
