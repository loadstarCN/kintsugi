import { Module } from '@nestjs/common';
import { DbAgentController } from './dbagent.controller';
import { DbAgentService } from './dbagent.service';
import { DataSourceModule } from '../datasource/datasource.module';

@Module({
  imports: [DataSourceModule],
  controllers: [DbAgentController],
  providers: [DbAgentService],
  exports: [DbAgentService],
})
export class DbAgentModule {}
