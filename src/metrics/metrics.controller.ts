import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // No ApiKeyGuard: a Prometheus scraper has no client API key, and metrics
  // are meant to be pulled by infrastructure, not end users. In a real
  // deployment this route would instead be restricted at the network level
  // (e.g. only reachable from the monitoring stack), not by app-level auth.
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
