import { Module } from '@nestjs/common';
import { OpenapiController, PlatformOpenapiController } from './openapi.controller';
import { OpenapiService } from './openapi.service';
import { DatasetModule } from '../dataset/dataset.module';

@Module({
  imports: [DatasetModule],
  controllers: [OpenapiController, PlatformOpenapiController],
  providers: [OpenapiService],
})
export class OpenapiModule {}
