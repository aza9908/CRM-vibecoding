import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionsModule } from '../sessions/sessions.module';
import { RecordingsController } from './recordings.controller';
import { RecordingDownloadController } from './recording-download.controller';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [AuthModule, SessionsModule],
  controllers: [RecordingsController, RecordingDownloadController],
  providers: [RecordingsService],
})
export class RecordingsModule {}
