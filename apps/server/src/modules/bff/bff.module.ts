import { Module } from '@nestjs/common';
import { BffController } from './bff.controller';
import { BffService } from './bff.service';
import { BffRuntime } from './bff-runtime';
import { InstantApiModule } from '../instant-api/instant-api.module';
import { CustomSqlModule } from '../custom-sql/custom-sql.module';
import { DataSourceModule } from '../datasource/datasource.module';

@Module({
  imports: [InstantApiModule, CustomSqlModule, DataSourceModule],
  controllers: [BffController],
  // BffRuntime 必须由 Nest DI 管理，否则 OnModuleDestroy 不触发，
  // app.close() 时 worker pool 不会回收，会留下若干僵尸子进程。
  providers: [BffService, BffRuntime],
  exports: [BffService],
})
export class BffModule {}
