import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/auth.guard';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; metadata: string }> {
    await this.prisma.$queryRaw`select 1`;
    return { status: 'ok', metadata: 'connected' };
  }
}
