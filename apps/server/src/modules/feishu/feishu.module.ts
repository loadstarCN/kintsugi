import { Module } from '@nestjs/common';
import { FeishuController } from './feishu.controller';
import { FeishuService } from './feishu.service';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [ChatsModule],
  controllers: [FeishuController],
  providers: [FeishuService],
})
export class FeishuModule {}
