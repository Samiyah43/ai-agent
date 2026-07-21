import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

function createConfigService(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

// A tiny in-memory stand-in for PrismaService, so these unit tests don't need
// a real database — it only supports the two calls ChatService actually makes.
function createFakePrisma(): PrismaService {
  const rows: { id: number; conversationId: string; role: string; data: string }[] = [];
  let nextId = 1;

  return {
    message: {
      create: jest.fn(async ({ data }: { data: { conversationId: string; role: string; data: string } }) => {
        const row = { id: nextId++, ...data };
        rows.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: { where: { conversationId: string } }) =>
        rows.filter((row) => row.conversationId === where.conversationId).sort((a, b) => a.id - b.id),
      ),
    },
  } as unknown as PrismaService;
}

describe('ChatService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('explains how to configure the API when no key exists', async () => {
    const configService = createConfigService({});
    const service = new ChatService(configService, createFakePrisma());

    await expect(service.createReply('Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the AI reply when OpenAI responds successfully', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Hello there!' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma());

    const result = await service.createReply('Hi');

    expect(result.reply).toBe('Hello there!');
    expect(result.conversationId).toEqual(expect.any(String));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'user', content: 'Hi' }]),
      }),
    );
  });

  it('falls back to a default message when OpenAI returns no text', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma());

    const result = await service.createReply('Hi');

    expect(result.reply).toBe('Sorry, I could not generate a reply. Please try again.');
  });

  it('remembers earlier turns in the same conversation', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Nice to meet you, Ali!' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Your name is Ali.' } }] });

    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma());

    const first = await service.createReply('My name is Ali');
    const second = await service.createReply('What is my name?', first.conversationId);

    expect(second.reply).toBe('Your name is Ali.');
    expect(mockCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'user', content: 'My name is Ali' },
          { role: 'assistant', content: 'Nice to meet you, Ali!' },
          { role: 'user', content: 'What is my name?' },
        ]),
      }),
    );
  });

  it('calls the calculator tool and returns the follow-up reply', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'calculator', arguments: '{"expression":"2 + 2"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'The answer is 4.' } }],
      });

    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma());

    const result = await service.createReply('What is 2 + 2?');

    expect(result.reply).toBe('The answer is 4.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_1', content: '4' }),
        ]),
      }),
    );
  });

  it('throws BadGatewayException when the OpenAI request fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreate.mockRejectedValue(new Error('network error'));
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma());

    await expect(service.createReply('Hi')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
