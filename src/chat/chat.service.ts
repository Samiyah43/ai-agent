import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { needsWebSearch, researchAgent } from './agents/research.agent';
import { routeToAgent } from './agents/router';
import { runCalculator } from './tools/calculator.tool';
import { runKnowledgeBase } from './tools/knowledge-base.tool';
import { runWeather } from './tools/weather.tool';
import { runWebSearch } from './tools/web-search.tool';

// Keeps this many of the most recent messages, so a long-running conversation
// doesn't grow the prompt (and cost) forever. The system prompt is added
// separately at request time (see createReply), based on whichever agent the
// router picks for the current message, so it isn't counted here.
const MAX_HISTORY_MESSAGES = 20;

export interface ChatReply {
  reply: string;
  conversationId: string;
}

// Events yielded by streamReply(), one per SSE message. 'delta' carries a
// fragment of the reply as it's generated; 'tool_call'/'tool_result' let the
// client show "using web_search..." while a tool runs; 'done'/'error' end
// the stream.
export type ChatStreamEvent =
  | { type: 'start'; conversationId: string }
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string };

@Injectable()
export class ChatService {
  private readonly client: OpenAI | null;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
  }

  async createReply(clientId: number, message: string, conversationId?: string): Promise<ChatReply> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OpenAI is not configured. Add OPENAI_API_KEY to your .env file and restart the server.',
      );
    }

    const id = conversationId ?? randomUUID();
    const history = await this.loadHistory(clientId, id);

    const userMessage: OpenAI.Chat.ChatCompletionMessageParam = { role: 'user', content: message };
    history.push(userMessage);
    await this.persist(clientId, id, userMessage);

    const model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5-mini';

    // Router picks a specialist agent per message (not persisted — a
    // conversation can be answered by a different agent each turn). The
    // system prompt therefore isn't stored in the DB; it's rebuilt here from
    // whichever agent handles this turn and prepended just for this call.
    const agent = routeToAgent(message);
    this.metrics.agentRequestsTotal.inc({ agent: agent.name });
    this.logger.log(`[router] "${message.slice(0, 80)}" -> ${agent.name}`);
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system',
      content: agent.systemPrompt,
    };

    try {
      let reply: string | undefined;

      // A single user message can need more than one tool (e.g. "news and weather"),
      // and a model can decide to call another tool after seeing the first tool's
      // result. Tools must stay available on every round, or the model can attempt
      // a call the API then rejects. MAX_TOOL_ROUNDS is a safety cap against a model
      // that keeps calling tools forever.
      const MAX_TOOL_ROUNDS = 5;
      const forceWebSearch = agent === researchAgent && needsWebSearch(message);

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await this.client.chat.completions.create({
          model,
          messages: [systemMessage, ...history],
          ...(agent.tools.length ? { tools: agent.tools } : {}),
          ...(round === 0 && forceWebSearch
            ? { tool_choice: { type: 'function' as const, function: { name: 'web_search' } } }
            : {}),
        });

        const responseMessage = response.choices[0]?.message;
        const toolCalls = responseMessage?.tool_calls;

        if (!toolCalls?.length) {
          reply = responseMessage?.content || 'Sorry, I could not generate a reply. Please try again.';
          break;
        }

        history.push(responseMessage);
        await this.persist(clientId, id, responseMessage);

        for (const toolCall of toolCalls) {
          const toolMessage: OpenAI.Chat.ChatCompletionMessageParam = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: await this.runTool(toolCall, clientId),
          };
          history.push(toolMessage);
          await this.persist(clientId, id, toolMessage);
        }
      }

      reply ??= 'Sorry, I could not generate a reply after multiple tool calls. Please try again.';

      await this.persist(clientId, id, { role: 'assistant', content: reply });

      return { reply, conversationId: id };
    } catch (error) {
      this.metrics.chatErrorsTotal.inc();
      this.logger.error('OpenAI request failed', error instanceof Error ? error.stack : error);
      throw new BadGatewayException(
        'The AI service could not respond right now. Please try again in a moment.',
      );
    }
  }

  // Same agent/tool-calling flow as createReply(), but yields events as the
  // model generates them instead of returning one finished string. An async
  // generator (function*) lets the controller do `for await (const event of
  // ...)` and forward each one to the client as it arrives, rather than
  // waiting for the whole reply to be ready.
  async *streamReply(
    clientId: number,
    message: string,
    conversationId?: string,
  ): AsyncGenerator<ChatStreamEvent> {
    if (!this.client) {
      yield {
        type: 'error',
        message: 'OpenAI is not configured. Add OPENAI_API_KEY to your .env file and restart the server.',
      };
      return;
    }

    const id = conversationId ?? randomUUID();
    yield { type: 'start', conversationId: id };

    const history = await this.loadHistory(clientId, id);
    const userMessage: OpenAI.Chat.ChatCompletionMessageParam = { role: 'user', content: message };
    history.push(userMessage);
    await this.persist(clientId, id, userMessage);

    const model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5-mini';
    const agent = routeToAgent(message);
    this.metrics.agentRequestsTotal.inc({ agent: agent.name });
    this.logger.log(`[router] "${message.slice(0, 80)}" -> ${agent.name}`);
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system',
      content: agent.systemPrompt,
    };

    try {
      const MAX_TOOL_ROUNDS = 5;
      const forceWebSearch = agent === researchAgent && needsWebSearch(message);
      let finalReply: string | undefined;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = await this.client.chat.completions.create({
          model,
          messages: [systemMessage, ...history],
          ...(agent.tools.length ? { tools: agent.tools } : {}),
          ...(round === 0 && forceWebSearch
            ? { tool_choice: { type: 'function' as const, function: { name: 'web_search' } } }
            : {}),
          stream: true,
        });

        // The API sends the reply in small pieces ("chunks"). Plain text
        // arrives as delta.content fragments, which we forward immediately.
        // A tool call arrives split up too — its id/name come in the first
        // chunk that mentions it, and its arguments string is built up
        // fragment by fragment across later chunks — so we accumulate them
        // by index until the round ends, then run the tool once complete.
        let contentBuffer = '';
        const toolCallsAcc = new Map<number, { id?: string; name?: string; args: string }>();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            contentBuffer += delta.content;
            yield { type: 'delta', content: delta.content };
          }
          for (const toolCallDelta of delta?.tool_calls ?? []) {
            const acc = toolCallsAcc.get(toolCallDelta.index) ?? { args: '' };
            if (toolCallDelta.id) acc.id = toolCallDelta.id;
            if (toolCallDelta.function?.name) acc.name = toolCallDelta.function.name;
            if (toolCallDelta.function?.arguments) acc.args += toolCallDelta.function.arguments;
            toolCallsAcc.set(toolCallDelta.index, acc);
          }
        }

        if (toolCallsAcc.size === 0) {
          finalReply = contentBuffer || 'Sorry, I could not generate a reply. Please try again.';
          break;
        }

        const toolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [...toolCallsAcc.values()].map(
          (acc) => ({
            id: acc.id ?? '',
            type: 'function' as const,
            function: { name: acc.name ?? '', arguments: acc.args },
          }),
        );

        const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = {
          role: 'assistant',
          content: contentBuffer || null,
          tool_calls: toolCalls,
        };
        history.push(assistantMessage);
        await this.persist(clientId, id, assistantMessage);

        for (const toolCall of toolCalls) {
          yield { type: 'tool_call', name: toolCall.function.name };
          const result = await this.runTool(toolCall, clientId);
          yield { type: 'tool_result', name: toolCall.function.name };
          const toolMessage: OpenAI.Chat.ChatCompletionMessageParam = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          };
          history.push(toolMessage);
          await this.persist(clientId, id, toolMessage);
        }
      }

      finalReply ??= 'Sorry, I could not generate a reply after multiple tool calls. Please try again.';
      await this.persist(clientId, id, { role: 'assistant', content: finalReply });
      yield { type: 'done', conversationId: id };
    } catch (error) {
      this.metrics.chatErrorsTotal.inc();
      this.logger.error('OpenAI streaming request failed', error instanceof Error ? error.stack : error);
      yield { type: 'error', message: 'The AI service could not respond right now. Please try again in a moment.' };
    }
  }

  // Loads a conversation's messages from the database, oldest first, excluding
  // any system row (older conversations, from before per-message routing, may
  // still have one persisted — the fresh agent-specific system prompt built in
  // createReply replaces it). Scoping by clientId too means a conversationId
  // from another client just looks new here, rather than leaking that client's
  // history.
  private async loadHistory(
    clientId: number,
    conversationId: string,
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const rows = await this.prisma.message.findMany({
      where: { clientId, conversationId },
      orderBy: { id: 'asc' },
    });

    const history = rows
      .map((row) => JSON.parse(row.data) as OpenAI.Chat.ChatCompletionMessageParam)
      .filter((row) => row.role !== 'system');
    return this.trimForModel(history);
  }

  // Only the most recent messages are sent to the model, so cost/context stays
  // bounded on a long-running conversation. Every message ever sent is still
  // kept in the database (see persist()).
  private trimForModel(
    history: OpenAI.Chat.ChatCompletionMessageParam[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return history.slice(-MAX_HISTORY_MESSAGES);
  }

  private async persist(
    clientId: number,
    conversationId: string,
    message: OpenAI.Chat.ChatCompletionMessageParam,
  ): Promise<void> {
    await this.prisma.message.create({
      data: { clientId, conversationId, role: message.role, data: JSON.stringify(message) },
    });
  }

  private async runTool(
    toolCall: OpenAI.Chat.ChatCompletionMessageToolCall,
    clientId: number,
  ): Promise<string> {
    if (toolCall.type !== 'function') {
      return `Error: unsupported tool call type "${toolCall.type}".`;
    }

    try {
      const args = JSON.parse(toolCall.function.arguments) as {
        expression?: string;
        location?: string;
        query?: string;
      };
      this.logger.log(`[tool call] ${toolCall.function.name}(${JSON.stringify(args)})`);

      let result: string;
      switch (toolCall.function.name) {
        case 'calculator':
          result = args.expression ? runCalculator(args.expression) : 'Error: no expression was provided.';
          break;
        case 'get_weather':
          result = args.location ? await runWeather(args.location) : 'Error: no location was provided.';
          break;
        case 'search_knowledge_base':
          result = args.query
            ? await runKnowledgeBase(args.query, clientId, this.prisma)
            : 'Error: no query was provided.';
          break;
        case 'web_search':
          result = args.query
            ? await runWebSearch(args.query, this.configService.get<string>('TAVILY_API_KEY'))
            : 'Error: no query was provided.';
          break;
        default:
          result = `Error: unknown tool "${toolCall.function.name}".`;
      }

      this.logger.log(`[tool result] ${toolCall.function.name} -> ${result.slice(0, 200)}`);
      this.metrics.toolCallsTotal.inc({
        tool: toolCall.function.name,
        outcome: result.startsWith('Error:') ? 'error' : 'ok',
      });
      return result;
    } catch {
      this.metrics.toolCallsTotal.inc({ tool: toolCall.function.name, outcome: 'error' });
      return 'Error: could not parse the tool arguments.';
    }
  }
}
