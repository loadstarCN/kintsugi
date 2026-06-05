import { Global, Module } from '@nestjs/common';
import { AccessKeyController } from './access-key.controller';
import { AccessKeyService } from './access-key.service';
import { HmacOrJwtGuard } from './hmac.guard';

@Global()
@Module({
  controllers: [AccessKeyController],
  providers: [AccessKeyService, HmacOrJwtGuard],
  exports: [AccessKeyService, HmacOrJwtGuard],
})
export class AccessKeyModule {}
