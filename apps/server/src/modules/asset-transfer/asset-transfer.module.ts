import { Module } from '@nestjs/common';
import { AssetTransferController } from './asset-transfer.controller';
import { AssetTransferService } from './asset-transfer.service';

@Module({
  controllers: [AssetTransferController],
  providers: [AssetTransferService],
  exports: [AssetTransferService],
})
export class AssetTransferModule {}
