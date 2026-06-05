import { Module } from '@nestjs/common';
import { CustomSqlController } from './custom-sql.controller';
import { CustomSqlService } from './custom-sql.service';
import { DataSourceModule } from '../datasource/datasource.module';

@Module({
  imports: [DataSourceModule],
  controllers: [CustomSqlController],
  providers: [CustomSqlService],
  exports: [CustomSqlService],
})
export class CustomSqlModule {}
