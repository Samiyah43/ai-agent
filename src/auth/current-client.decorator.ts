import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithClient } from './api-key.guard';

// Only valid on routes behind ApiKeyGuard, which populates request.clientId.
export const CurrentClient = createParamDecorator((_data: unknown, ctx: ExecutionContext): number => {
  const request = ctx.switchToHttp().getRequest<RequestWithClient>();
  return request.clientId;
});
