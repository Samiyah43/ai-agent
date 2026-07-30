import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// FREE is the default plan and never requires a checkout session.
export const PAID_PLANS = ['PRO', 'BUSINESS'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export class CreateCheckoutSessionDto {
  @ApiProperty({ enum: PAID_PLANS })
  @IsIn(PAID_PLANS)
  plan: PaidPlan;
}
