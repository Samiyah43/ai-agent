import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RequestWithClient } from './api-key.guard';

const PER_CLIENT_LIMIT = 20;
const PER_CLIENT_TTL_MS = 60_000;

// Must be listed AFTER ApiKeyGuard in @UseGuards() so request.clientId is
// already set by the time this runs. This deliberately bypasses the base
// class's canActivate() (which would reuse the app-wide, IP-tracked
// 'default' throttler config) and calls handleRequest() directly with its
// own fixed, client-tracked budget instead. That keeps this limit fully
// independent of the global IP-based guard in AppModule — one client's
// traffic can never eat into another client's quota, even if two clients
// happen to call from behind the same IP (e.g. a shared corporate proxy).
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    return this.handleRequest({
      context,
      limit: PER_CLIENT_LIMIT,
      ttl: PER_CLIENT_TTL_MS,
      throttler: { name: 'per-client', limit: PER_CLIENT_LIMIT, ttl: PER_CLIENT_TTL_MS },
      blockDuration: PER_CLIENT_TTL_MS,
      getTracker: async (req: RequestWithClient) => `client-${req.clientId}`,
      generateKey: (ctx, tracker, name) => this.generateKey(ctx, tracker, name),
    });
  }
}
