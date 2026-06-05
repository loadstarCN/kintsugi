import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { DataSourceModule } from '../datasource/datasource.module';

@Module({
  imports: [DataSourceModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
