import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

describe('ChatService', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('explains how to configure the API when no key exists', async () => {
    const configService = createConfigService({});
    const service = new ChatService(configService);

    await expect(service.createReply('Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the AI reply when OpenAI responds successfully', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Hello there!' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService);

    const reply = await service.createReply('Hi');

    expect(reply).toBe('Hello there!');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'user', content: 'Hi' }]),
      }),
    );
  });

  it('falls back to a default message when OpenAI returns no text', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService);

    const reply = await service.createReply('Hi');

    expect(reply).toBe('Sorry, I could not generate a reply. Please try again.');
  });

  it('throws BadGatewayException when the OpenAI request fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreate.mockRejectedValue(new Error('network error'));
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService);

    await expect(service.createReply('Hi')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
