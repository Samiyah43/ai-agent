import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { calculatorToolDefinition, runCalculator } from './tools/calculator.tool';
import { knowledgeBaseToolDefinition, runKnowledgeBase } from './tools/knowledge-base.tool';
import { runWeather, weatherToolDefinition } from './tools/weather.tool';
import { runWebSearch, webSearchToolDefinition } from './tools/web-search.tool';

const CHATBOT_INSTRUCTIONS = [
  'You are a helpful, beginner-friendly AI chatbot.',
  'Reply clearly and honestly.',
  'Use short sections or steps when they make an explanation easier to follow.',
  'If the user writes in Roman Urdu, reply in Roman Urdu unless they ask for another language.',
  'For any question that could plausibly be about a company policy, procedure, or other topic that might be documented (e.g. leave, remote work, security, benefits, "the document", "this file"), you must call search_knowledge_base first. Never rely on your own general/textbook knowledge for these topics, even if you think you already know a typical answer — the user only wants what is actually in their own uploaded documents. Only ask the user to clarify if the tool returns no relevant results.',
  'When you answer using results from the search_knowledge_base tool, only state facts that are explicitly present in those results.',
  'Do not add extra steps, numbers, features, or claims that are not in the retrieved text, even if they sound plausible.',
  'If the retrieved text does not fully answer the question, say what it does cover and clearly note that the rest is not in the knowledge base.',
  'For questions about current events, recent news, live prices, or anything that changes over time or could be after your training cutoff, call web_search instead of answering from memory. This includes comparisons or facts about specific products, companies, tools, or technologies (e.g. "compare X and Y", "which is better", specs, pricing, version numbers) — these change often and your own knowledge of them may be outdated or wrong, so verify with web_search rather than guessing.',
  'When you answer using web_search results, end your reply with a "Sources" section listing the URLs from the tool results, so the user can verify the information themselves.',
].join(' ');

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  calculatorToolDefinition,
  weatherToolDefinition,
  knowledgeBaseToolDefinition,
  webSearchToolDefinition,
];

// Keeps the system message plus this many of the most recent messages, so a
// long-running conversation doesn't grow the prompt (and cost) forever.
const MAX_HISTORY_MESSAGES = 20;

// Small/free models often "think" they already know the answer to questions like
// this and skip web_search despite the system instructions, then answer from
// stale training data. Rather than relying entirely on the model's own judgement,
// these keywords force a web_search on the first round as a deterministic fallback.
const CURRENT_INFO_PATTERN =
  /\b(compare|comparison|vs\.?|versus|which is better|latest|newest|current|price|pricing|news|update|release|version)\b|\b(aaj|abhi|taza|khabar|keemat)\b/i;

function needsWebSearch(message: string): boolean {
  return CURRENT_INFO_PATTERN.test(message);
}

export interface ChatReply {
  reply: string;
  conversationId: string;
}

@Injectable()
export class ChatService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
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

    try {
      let reply: string | undefined;

      // A single user message can need more than one tool (e.g. "news and weather"),
      // and a model can decide to call another tool after seeing the first tool's
      // result. Tools must stay available on every round, or the model can attempt
      // a call the API then rejects. MAX_TOOL_ROUNDS is a safety cap against a model
      // that keeps calling tools forever.
      const MAX_TOOL_ROUNDS = 5;
      const forceWebSearch = needsWebSearch(message);

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await this.client.chat.completions.create({
          model,
          messages: history,
          tools: TOOLS,
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
      console.error('OpenAI request failed:', error);
      throw new BadGatewayException(
        'The AI service could not respond right now. Please try again in a moment.',
      );
    }
  }

  // Loads a conversation's messages from the database, oldest first. A brand-new
  // conversationId has no rows yet, so we seed it with the system prompt. Scoping
  // by clientId too means a conversationId from another client just looks new
  // here, rather than leaking that client's history.
  private async loadHistory(
    clientId: number,
    conversationId: string,
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const rows = await this.prisma.message.findMany({
      where: { clientId, conversationId },
      orderBy: { id: 'asc' },
    });

    if (!rows.length) {
      const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'system',
        content: CHATBOT_INSTRUCTIONS,
      };
      await this.persist(clientId, conversationId, systemMessage);
      return [systemMessage];
    }

    const history = rows.map((row) => JSON.parse(row.data) as OpenAI.Chat.ChatCompletionMessageParam);
    return this.trimForModel(history);
  }

  // Every message ever sent is kept in the database, but only the system message
  // plus the most recent messages are sent to the model, so cost/context stays bounded.
  private trimForModel(
    history: OpenAI.Chat.ChatCompletionMessageParam[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (history.length <= MAX_HISTORY_MESSAGES) {
      return history;
    }
    const [systemMessage] = history;
    return [systemMessage, ...history.slice(-(MAX_HISTORY_MESSAGES - 1))];
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
      console.log(`[tool call] ${toolCall.function.name}(${JSON.stringify(args)})`);

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

      console.log(`[tool result] ${toolCall.function.name} -> ${result.slice(0, 200)}`);
      return result;
    } catch {
      return 'Error: could not parse the tool arguments.';
    }
  }
}
