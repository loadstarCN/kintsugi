import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { DingtalkController } from './dingtalk.controller';
import { DingtalkService } from './dingtalk.service';

@Module({
  imports: [ChatsModule],
  controllers: [DingtalkController],
  providers: [DingtalkService],
})
export class DingtalkModule {}
