import { BadRequestException, Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { CurrentClient } from '../auth/current-client.decorator';
import { BillingService } from './billing.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Create a Stripe Checkout session to upgrade to a paid plan' })
  async checkout(@Body() body: CreateCheckoutSessionDto, @CurrentClient() clientId: number) {
    return this.billingService.createCheckoutSession(clientId, body.plan);
  }

  // Called by Stripe's servers, not by our clients — authenticated via the
  // stripe-signature header (verified against the raw body) instead of an
  // API key, so this route deliberately has no ApiKeyGuard.
  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing request body or stripe-signature header.');
    }

    let event;
    try {
      event = this.billingService.constructEvent(req.rawBody, signature);
    } catch (err) {
      throw new BadRequestException(`Webhook signature verification failed: ${(err as Error).message}`);
    }

    // Deliberately outside the try/catch: a failure here is our bug (e.g. DB
    // unreachable), not a bad request, so it should surface as a 500 and let
    // Stripe's automatic retry redeliver the event later.
    await this.billingService.handleEvent(event);
    return { received: true };
  }
}
