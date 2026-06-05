import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module';
import { WecomController } from './wecom.controller';
import { WecomService } from './wecom.service';

@Module({
  imports: [ChatsModule],
  controllers: [WecomController],
  providers: [WecomService],
})
export class WecomModule {}
