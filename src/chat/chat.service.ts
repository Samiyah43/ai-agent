import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDefinition } from './agents/agent.types';
import { needsWebSearch, researchAgent } from './agents/research.agent';
import { routeToAgent } from './agents/router';
import { createPlan, looksMultiStep } from './agents/task-planner';
import { runCalculator } from './tools/calculator.tool';
import { KB_EMPTY_ERROR, KB_NO_MATCH_ERROR, runKnowledgeBase } from './tools/knowledge-base.tool';
import { runWeather } from './tools/weather.tool';
import { runWebSearch } from './tools/web-search.tool';

// Keeps this many of the most recent messages, so a long-running conversation
// doesn't grow the prompt (and cost) forever. The system prompt is added
// separately at request time (see createReply), based on whichever agent the
// router picks for the current message, so it isn't counted here.
const MAX_HISTORY_MESSAGES = 20;

// No-hallucination guardrail: if search_knowledge_base was the only tool
// called this round and it found nothing, the reply is forced to this fixed
// message instead of letting the model generate its own — a system-prompt
// instruction ("don't guess") is only a request the model can ignore, this
// is a hard guarantee that never reaches the model's own general knowledge.
export const KB_HONEST_FALLBACK_REPLY =
  "I couldn't find anything about that in the knowledge base, so I don't want to guess. Please reach out to our support team directly for help with this one.";

function isUngroundedKnowledgeBaseLookup(
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[],
  results: string[],
): boolean {
  const [only] = toolCalls;
  return (
    toolCalls.length === 1 &&
    only.type === 'function' &&
    only.function.name === 'search_knowledge_base' &&
    (results[0] === KB_EMPTY_ERROR || results[0] === KB_NO_MATCH_ERROR)
  );
}

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
    const priorHistory = await this.loadHistory(clientId, id);
    const model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5-mini';

    const userMessage: OpenAI.Chat.ChatCompletionMessageParam = { role: 'user', content: message };
    await this.persist(clientId, id, userMessage);

    try {
      // Cheap regex pre-filter first (see looksMultiStep) — only messages that
      // actually look like they contain more than one request pay for the
      // extra planning LLM call below.
      if (looksMultiStep(message)) {
        const steps = await createPlan(this.client, model, message);
        if (steps.length > 1) {
          // The raw compound message is deliberately left out of the history
          // each step's LLM call sees — otherwise the model notices the other
          // half of the request sitting right there and answers it too,
          // defeating the point of splitting the work into isolated steps.
          const planHistory = [...priorHistory];
          return { reply: await this.runPlan(clientId, id, model, planHistory, steps), conversationId: id };
        }
        this.logger.log(`[planner] "${message.slice(0, 80)}" looked multi-step but collapsed to 1 step, falling back to normal routing`);
      }

      // Router picks a specialist agent per message (not persisted — a
      // conversation can be answered by a different agent each turn). The
      // system prompt therefore isn't stored in the DB; it's rebuilt here from
      // whichever agent handles this turn and prepended just for this call.
      const history = [...priorHistory, userMessage];
      const agent = routeToAgent(message);
      this.metrics.agentRequestsTotal.inc({ agent: agent.name });
      this.logger.log(`[router] "${message.slice(0, 80)}" -> ${agent.name}`);

      const reply = await this.runAgentTurn(clientId, id, agent, model, history);
      return { reply, conversationId: id };
    } catch (error) {
      this.metrics.chatErrorsTotal.inc();
      this.logger.error('OpenAI request failed', error instanceof Error ? error.stack : error);
      throw new BadGatewayException(
        'The AI service could not respond right now. Please try again in a moment.',
      );
    }
  }

  // Runs a message's request end-to-end through one specialist agent's
  // tool-calling loop and persists the final reply. Shared by the
  // single-agent path in createReply() and by each step of runPlan() below —
  // extracted so a multi-step plan can reuse the exact same round-loop
  // (including the no-hallucination guardrail) per step instead of
  // duplicating it.
  private async runAgentTurn(
    clientId: number,
    id: string,
    agent: AgentDefinition,
    model: string,
    history: OpenAI.Chat.ChatCompletionMessageParam[],
  ): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException('OpenAI client is not configured.');
    }
    const client = this.client;

    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system',
      content: agent.systemPrompt,
    };

    let reply: string | undefined;

    // A single user message can need more than one tool (e.g. "news and weather"),
    // and a model can decide to call another tool after seeing the first tool's
    // result. Tools must stay available on every round, or the model can attempt
    // a call the API then rejects. MAX_TOOL_ROUNDS is a safety cap against a model
    // that keeps calling tools forever.
    const MAX_TOOL_ROUNDS = 5;
    const lastUserMessage = [...history].reverse().find((m) => m.role === 'user');
    const forceWebSearch =
      agent === researchAgent &&
      typeof lastUserMessage?.content === 'string' &&
      needsWebSearch(lastUserMessage.content);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.chat.completions.create({
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

      const results: string[] = [];
      for (const toolCall of toolCalls) {
        const result = await this.runTool(toolCall, clientId);
        results.push(result);
        const toolMessage: OpenAI.Chat.ChatCompletionMessageParam = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        };
        history.push(toolMessage);
        await this.persist(clientId, id, toolMessage);
      }

      if (isUngroundedKnowledgeBaseLookup(toolCalls, results)) {
        reply = KB_HONEST_FALLBACK_REPLY;
        break;
      }
    }

    reply ??= 'Sorry, I could not generate a reply after multiple tool calls. Please try again.';
    await this.persist(clientId, id, { role: 'assistant', content: reply });
    return reply;
  }

  // Executes a multi-step plan sequentially: each step is routed to its own
  // specialist agent and run through the normal tool-calling loop, in order,
  // so a later step can see earlier steps' replies in `history`. Each step's
  // synthetic prompt is persisted with a "[Task Planner ...]" prefix so the
  // conversation log stays honest about what the user actually typed versus
  // what the planner derived from it.
  private async runPlan(
    clientId: number,
    id: string,
    model: string,
    history: OpenAI.Chat.ChatCompletionMessageParam[],
    steps: string[],
  ): Promise<string> {
    this.metrics.taskPlansTotal.inc();
    this.metrics.taskPlanSteps.observe(steps.length);
    this.logger.log(`[planner] split into ${steps.length} steps: ${JSON.stringify(steps)}`);

    const stepReplies: { step: string; agent: string; reply: string }[] = [];

    for (const [index, step] of steps.entries()) {
      const stepMessage: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'user',
        content: `[Task Planner — step ${index + 1}/${steps.length}] ${step}`,
      };
      history.push(stepMessage);
      await this.persist(clientId, id, stepMessage);

      const agent = routeToAgent(step);
      this.metrics.agentRequestsTotal.inc({ agent: agent.name });
      this.logger.log(`[planner step ${index + 1}] "${step.slice(0, 80)}" -> ${agent.name}`);

      const reply = await this.runAgentTurn(clientId, id, agent, model, history);
      stepReplies.push({ step, agent: agent.name, reply });
    }

    return stepReplies.map((r, i) => `${i + 1}. ${r.step}\n${r.reply}`).join('\n\n');
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

        const results: string[] = [];
        for (const toolCall of toolCalls) {
          yield { type: 'tool_call', name: toolCall.function.name };
          const result = await this.runTool(toolCall, clientId);
          results.push(result);
          yield { type: 'tool_result', name: toolCall.function.name };
          const toolMessage: OpenAI.Chat.ChatCompletionMessageParam = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          };
          history.push(toolMessage);
          await this.persist(clientId, id, toolMessage);
        }

        if (isUngroundedKnowledgeBaseLookup(toolCalls, results)) {
          yield { type: 'delta', content: KB_HONEST_FALLBACK_REPLY };
          finalReply = KB_HONEST_FALLBACK_REPLY;
          break;
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
