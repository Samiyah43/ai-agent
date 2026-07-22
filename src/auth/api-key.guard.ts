import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './api-key-hash';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.header('x-api-key');

    if (!key) {
      throw new UnauthorizedException('Missing "x-api-key" header.');
    }

    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(key) } });

    if (!apiKey || apiKey.revokedAt) {
      throw new UnauthorizedException('Invalid or revoked API key.');
    }

    return true;
  }
}
