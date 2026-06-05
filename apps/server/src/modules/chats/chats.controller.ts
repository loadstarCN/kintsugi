import { Body, Controller, Post, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ChatsService } from './chats.service';
import type { JwtPayload } from '../auth/auth.service';

class AskDto {
  @IsString() appCode!: string;
  @IsString() question!: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) maxTables?: number;
}

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: {
    appCode: string;
    tenantCode: string;
    createdBy: string | null;
    boundUserId: string | null;
  };
}

@Controller('chats')
export class ChatsController {
  constructor(private readonly svc: ChatsService) {}

  @Post('ask')
  ask(@Req() req: ReqWithUser, @Body() body: AskDto) {
    return this.svc.ask({
      appCode: body.appCode,
      question: body.question,
      ...(body.maxTables !== undefined ? { maxTables: body.maxTables } : {}),
      ...(req.user
        ? { user: { tenantCode: req.user.tenantCode, userId: req.user.sub } }
        : req.accessKeyCtx
          ? {
              user: {
                tenantCode: req.accessKeyCtx.tenantCode,
                ...(req.accessKeyCtx.boundUserId
                  ? { userId: req.accessKeyCtx.boundUserId }
                  : {}),
              },
            }
          : {}),
    });
  }
}
