import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getStatus() {
    return this.appService.getStatus();
  }

  @SkipThrottle()
  @Get('health')
  getHealth() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
