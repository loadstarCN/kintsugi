import { Module } from '@nestjs/common';
import { TrialAdminController, TrialController } from './trial.controller';
import { TrialService } from './trial.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [TrialController, TrialAdminController],
  providers: [TrialService],
  exports: [TrialService],
})
export class TrialModule {}
