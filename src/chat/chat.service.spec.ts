import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

// ChatService only calls .inc() on these two counters — a minimal stand-in
// is enough, matching the style of createFakePrisma() below.
function createFakeMetrics(): MetricsService {
  return {
    chatErrorsTotal: { inc: jest.fn() },
    toolCallsTotal: { inc: jest.fn() },
    agentRequestsTotal: { inc: jest.fn() },
  } as unknown as MetricsService;
}

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

const CLIENT_ID = 1;

// The OpenAI SDK returns an async-iterable "Stream" object when stream:true
// is passed. This stands in for it: each item is one ChatCompletionChunk.
async function* fakeStream(
  chunks: { content?: string; toolCalls?: { index: number; id?: string; name?: string; args?: string }[] }[],
) {
  for (const chunk of chunks) {
    yield {
      choices: [
        {
          delta: {
            ...(chunk.content !== undefined ? { content: chunk.content } : {}),
            ...(chunk.toolCalls
              ? {
                  tool_calls: chunk.toolCalls.map((tc) => ({
                    index: tc.index,
                    id: tc.id,
                    function: { name: tc.name, arguments: tc.args },
                  })),
                }
              : {}),
          },
        },
      ],
    };
  }
}

// Drains an async generator (streamReply's return type) into a plain array,
// so assertions below can use ordinary array matchers.
async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

// A tiny in-memory stand-in for PrismaService, so these unit tests don't need
// a real database — it only supports the two calls ChatService actually makes.
function createFakePrisma(): PrismaService {
  const rows: { id: number; clientId: number; conversationId: string; role: string; data: string }[] = [];
  let nextId = 1;

  return {
    message: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: { clientId: number; conversationId: string; role: string; data: string };
        }) => {
          const row = { id: nextId++, ...data };
          rows.push(row);
          return row;
        },
      ),
      findMany: jest.fn(async ({ where }: { where: { clientId: number; conversationId: string } }) =>
        rows
          .filter((row) => row.clientId === where.clientId && row.conversationId === where.conversationId)
          .sort((a, b) => a.id - b.id),
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
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await expect(service.createReply(CLIENT_ID,'Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the AI reply when OpenAI responds successfully', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Hello there!' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    const result = await service.createReply(CLIENT_ID,'Hi');

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
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    const result = await service.createReply(CLIENT_ID,'Hi');

    expect(result.reply).toBe('Sorry, I could not generate a reply. Please try again.');
  });

  it('remembers earlier turns in the same conversation', async () => {
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Nice to meet you, Ali!' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Your name is Ali.' } }] });

    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    const first = await service.createReply(CLIENT_ID,'My name is Ali');
    const second = await service.createReply(CLIENT_ID,'What is my name?', first.conversationId);

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
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    const result = await service.createReply(CLIENT_ID,'What is 2 + 2?');

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

  it('forces a web_search tool_choice on the first round for current-info questions', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: 'Result', url: 'https://example.com', content: 'text' }] }),
    }) as unknown as typeof fetch;

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
                  function: { name: 'web_search', arguments: '{"query":"ChatGPT vs Claude vs Gemini"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Here is a comparison with sources.' } }],
      });

    const configService = createConfigService({ OPENAI_API_KEY: 'test-key', TAVILY_API_KEY: 'tavily-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await service.createReply(CLIENT_ID,'Compare ChatGPT, Claude and Gemini');

    expect(mockCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tool_choice: { type: 'function', function: { name: 'web_search' } },
      }),
    );
    expect(mockCreate).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ tool_choice: expect.anything() }),
    );

    global.fetch = originalFetch;
  });

  it('does not force tool_choice for ordinary questions', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Hello there!' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await service.createReply(CLIENT_ID,'Hi, how are you?');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ tool_choice: expect.anything() }),
    );
  });

  it('routes a math question to the math-data agent (only calculator/weather tools offered)', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '4' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await service.createReply(CLIENT_ID, 'What is 2 + 2?');

    const toolNames = (mockCreate.mock.calls[0][0].tools as { function: { name: string } }[]).map(
      (tool) => tool.function.name,
    );
    expect(toolNames.sort()).toEqual(['calculator', 'get_weather']);
  });

  it('routes small talk to the general agent (no tools offered)', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Hey there!' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await service.createReply(CLIENT_ID, 'Hello!');

    expect(mockCreate.mock.calls[0][0].tools).toBeUndefined();
  });

  it('routes an ordinary question to the research agent (web_search/knowledge_base tools offered)', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Some answer.' } }] });
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await service.createReply(CLIENT_ID, "What is our company's leave policy?");

    const toolNames = (mockCreate.mock.calls[0][0].tools as { function: { name: string } }[]).map(
      (tool) => tool.function.name,
    );
    expect(toolNames.sort()).toEqual(['search_knowledge_base', 'web_search']);
  });

  it('throws BadGatewayException when the OpenAI request fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockCreate.mockRejectedValue(new Error('network error'));
    const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
    const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

    await expect(service.createReply(CLIENT_ID,'Hi')).rejects.toBeInstanceOf(BadGatewayException);
  });

  describe('streamReply', () => {
    it('yields an error event when no API key exists', async () => {
      const configService = createConfigService({});
      const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

      const events = await collect(service.streamReply(CLIENT_ID, 'Hello'));

      expect(events).toEqual([
        { type: 'error', message: expect.stringContaining('OPENAI_API_KEY') },
      ]);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('streams content deltas then a done event', async () => {
      mockCreate.mockResolvedValue(fakeStream([{ content: 'Hello ' }, { content: 'there!' }]));
      const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
      const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

      const events = await collect(service.streamReply(CLIENT_ID, 'Hi'));

      expect(events[0]).toEqual({ type: 'start', conversationId: expect.any(String) });
      expect(events.slice(1, 3)).toEqual([
        { type: 'delta', content: 'Hello ' },
        { type: 'delta', content: 'there!' },
      ]);
      expect(events.at(-1)).toEqual({ type: 'done', conversationId: expect.any(String) });
    });

    it('emits tool_call/tool_result events around a calculator call, then streams the follow-up reply', async () => {
      mockCreate
        .mockResolvedValueOnce(
          fakeStream([
            { toolCalls: [{ index: 0, id: 'call_1', name: 'calculator', args: '' }] },
            { toolCalls: [{ index: 0, args: '{"expression":"2 + 2"}' }] },
          ]),
        )
        .mockResolvedValueOnce(fakeStream([{ content: 'The answer is 4.' }]));

      const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
      const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

      const events = await collect(service.streamReply(CLIENT_ID, 'What is 2 + 2?'));

      expect(events).toEqual(
        expect.arrayContaining([
          { type: 'tool_call', name: 'calculator' },
          { type: 'tool_result', name: 'calculator' },
          { type: 'delta', content: 'The answer is 4.' },
        ]),
      );
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'tool', tool_call_id: 'call_1', content: '4' }),
          ]),
        }),
      );
    });

    it('yields an error event when the OpenAI request fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockCreate.mockRejectedValue(new Error('network error'));
      const configService = createConfigService({ OPENAI_API_KEY: 'test-key' });
      const service = new ChatService(configService, createFakePrisma(), createFakeMetrics());

      const events = await collect(service.streamReply(CLIENT_ID, 'Hi'));

      expect(events.at(-1)).toEqual({
        type: 'error',
        message: expect.stringContaining('try again'),
      });
    });
  });
});
