import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MailService } from './mail.service';

/**
 * Transactional email. Global because several modules (auth today, invitations
 * and session reminders later) need it without re-importing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
