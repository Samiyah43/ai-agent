import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getEffectivePlan, PLAN_LIMIT_TTL_MS, PLAN_LIMITS } from '../billing/plan-limits';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithClient } from './api-key.guard';

// Must be listed AFTER ApiKeyGuard in @UseGuards() so request.clientId is
// already set by the time this runs. This deliberately bypasses the base
// class's canActivate() (which would reuse the app-wide, IP-tracked
// 'default' throttler config) and calls handleRequest() directly with its
// own client-tracked budget instead. That keeps this limit fully
// independent of the global IP-based guard in AppModule — one client's
// traffic can never eat into another client's quota, even if two clients
// happen to call from behind the same IP (e.g. a shared corporate proxy).
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  // Property injection (rather than a constructor param) so this class
  // doesn't have to redeclare ThrottlerGuard's own constructor + its
  // @Inject decorators just to add one more dependency.
  @Inject(PrismaService)
  private readonly prisma!: PrismaService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithClient>();
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: request.clientId } });
    const limit = PLAN_LIMITS[getEffectivePlan(client)];

    return this.handleRequest({
      context,
      limit,
      ttl: PLAN_LIMIT_TTL_MS,
      throttler: { name: 'per-client', limit, ttl: PLAN_LIMIT_TTL_MS },
      blockDuration: PLAN_LIMIT_TTL_MS,
      getTracker: async (req: RequestWithClient) => `client-${req.clientId}`,
      generateKey: (ctx, tracker, name) => this.generateKey(ctx, tracker, name),
    });
  }
}
