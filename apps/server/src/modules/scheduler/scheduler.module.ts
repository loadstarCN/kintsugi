import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchedulerService } from './scheduler.service';
import { MailModule } from '../mail/mail.module';

// WebhookModule 是 @Global，无需在此 import；MailModule 不是 global，显式接进来。
@Module({
  imports: [PrismaModule, MailModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
