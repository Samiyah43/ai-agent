import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './api-key-hash';
import { ApiKeyGuard } from './api-key.guard';

function createFakePrisma(plainKeys: { key: string; revokedAt: Date | null }[]) {
  const apiKeys = plainKeys.map(({ key, revokedAt }) => ({ keyHash: hashApiKey(key), revokedAt }));

  return {
    apiKey: {
      findUnique: jest.fn(async ({ where: { keyHash } }: { where: { keyHash: string } }) =>
        apiKeys.find((entry) => entry.keyHash === keyHash) ?? null,
      ),
    },
  } as unknown as PrismaService;
}

function createContext(headerValue: string | undefined): ExecutionContext {
  const request = { header: jest.fn().mockReturnValue(headerValue) };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  it('throws UnauthorizedException when the header is missing', async () => {
    const guard = new ApiKeyGuard(createFakePrisma([]));

    await expect(guard.canActivate(createContext(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for an unknown key', async () => {
    const guard = new ApiKeyGuard(createFakePrisma([]));

    await expect(guard.canActivate(createContext('unknown-key'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for a revoked key', async () => {
    const guard = new ApiKeyGuard(createFakePrisma([{ key: 'revoked-key', revokedAt: new Date() }]));

    await expect(guard.canActivate(createContext('revoked-key'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a valid, non-revoked key by comparing its hash', async () => {
    const guard = new ApiKeyGuard(createFakePrisma([{ key: 'good-key', revokedAt: null }]));

    await expect(guard.canActivate(createContext('good-key'))).resolves.toBe(true);
  });
});
