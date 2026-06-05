import { Module } from '@nestjs/common';
import { SdkDownloadController } from './sdk-download.controller';

@Module({
  controllers: [SdkDownloadController],
})
export class SdkDownloadModule {}
