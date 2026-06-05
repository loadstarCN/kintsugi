import { Module } from '@nestjs/common';
import { AdminUpgradeRequestsController, BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [BillingController, AdminUpgradeRequestsController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
