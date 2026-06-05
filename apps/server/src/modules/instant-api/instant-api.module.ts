import { Module } from '@nestjs/common';
import { InstantApiController } from './instant-api.controller';
import { InstantApiService } from './instant-api.service';
import { DataSourceModule } from '../datasource/datasource.module';
import { DatasetModule } from '../dataset/dataset.module';

@Module({
  imports: [DataSourceModule, DatasetModule],
  controllers: [InstantApiController],
  providers: [InstantApiService],
  exports: [InstantApiService],
})
export class InstantApiModule {}
