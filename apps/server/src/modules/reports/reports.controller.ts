import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsOptional, IsInt, IsString, Max, Min } from 'class-validator';
import { ReportsService } from './reports.service';

class AskDto {
  @IsString() question!: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) maxTables?: number;
}

@Controller('apps/:appCode/reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post('ask')
  ask(@Param('appCode') appCode: string, @Body() body: AskDto) {
    return this.svc.ask({
      appCode,
      question: body.question,
      ...(body.maxTables !== undefined ? { maxTables: body.maxTables } : {}),
    });
  }
}
