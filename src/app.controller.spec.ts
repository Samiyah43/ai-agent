import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

function createFakePrisma(queryRaw: jest.Mock): PrismaService {
  return { $queryRaw: queryRaw } as unknown as PrismaService;
}

describe('AppController', () => {
  async function createController(prisma: PrismaService): Promise<AppController> {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    return app.get<AppController>(AppController);
  }

  describe('root', () => {
    it('should return the API status', async () => {
      const appController = await createController(createFakePrisma(jest.fn()));

      expect(appController.getStatus()).toEqual({
        name: 'AI Chatbot API',
        status: 'running',
        chatEndpoint: 'POST /chat',
      });
    });
  });

  describe('health', () => {
    it('returns ok when the database is reachable', async () => {
      const appController = await createController(createFakePrisma(jest.fn().mockResolvedValue([{ 1: 1 }])));

      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
        uptimeSeconds: expect.any(Number),
        database: 'ok',
      });
    });

    it('throws ServiceUnavailableException when the database is unreachable', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const appController = await createController(
        createFakePrisma(jest.fn().mockRejectedValue(new Error('db down'))),
      );

      await expect(appController.getHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
