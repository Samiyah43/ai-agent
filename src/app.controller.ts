import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from './prisma/prisma.service';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getStatus() {
    return this.appService.getStatus();
  }

  // A cheap, schema-independent query (SELECT 1) proves the DB connection is
  // actually alive, not just that the process is running — so an
  // orchestrator/load balancer polling this can correctly take the instance
  // out of rotation if the database is unreachable.
  @SkipThrottle()
  @Get('health')
  async getHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error('Health check failed: database unreachable', error instanceof Error ? error.stack : error);
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }

    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()), database: 'ok' };
  }
}
