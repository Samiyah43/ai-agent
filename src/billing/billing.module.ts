import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, ApiKeyGuard],
})
export class BillingModule {}
