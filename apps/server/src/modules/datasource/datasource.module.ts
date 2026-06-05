import { Module } from '@nestjs/common';
import { DataSourceController } from './datasource.controller';
import { DataSourceService } from './datasource.service';

@Module({
  controllers: [DataSourceController],
  providers: [DataSourceService],
  exports: [DataSourceService],
})
export class DataSourceModule {}
