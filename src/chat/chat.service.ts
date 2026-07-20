import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { calculatorToolDefinition, runCalculator } from './tools/calculator.tool';

const CHATBOT_INSTRUCTIONS = [
  'You are a helpful, beginner-friendly AI chatbot.',
  'Reply clearly and honestly.',
  'Use short sections or steps when they make an explanation easier to follow.',
  'If the user writes in Roman Urdu, reply in Roman Urdu unless they ask for another language.',
].join(' ');

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [calculatorToolDefinition];

// Keeps the system message plus this many of the most recent messages, so a
// long-running conversation doesn't grow the prompt (and cost) forever.
const MAX_HISTORY_MESSAGES = 20;

export interface ChatReply {
  reply: string;
  conversationId: string;
}

@Injectable()
export class ChatService {
  private readonly client: OpenAI | null;
  private readonly conversations = new Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>();

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
  }

  async createReply(message: string, conversationId?: string): Promise<ChatReply> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OpenAI is not configured. Add OPENAI_API_KEY to your .env file and restart the server.',
      );
    }

    const id = conversationId ?? randomUUID();
    const history =
      this.conversations.get(id) ?? ([{ role: 'system', content: CHATBOT_INSTRUCTIONS }] as OpenAI.Chat.ChatCompletionMessageParam[]);
    history.push({ role: 'user', content: message });

    const model = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5-mini';

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: history,
        tools: TOOLS,
      });

      const responseMessage = response.choices[0]?.message;
      const toolCalls = responseMessage?.tool_calls;
      let reply: string;

      if (!toolCalls?.length) {
        reply = responseMessage?.content || 'Sorry, I could not generate a reply. Please try again.';
      } else {
        history.push(responseMessage);
        for (const toolCall of toolCalls) {
          history.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: this.runTool(toolCall),
          });
        }

        const followUp = await this.client.chat.completions.create({ model, messages: history });
        reply =
          followUp.choices[0]?.message?.content ||
          'Sorry, I could not generate a reply. Please try again.';
      }

      history.push({ role: 'assistant', content: reply });
      this.trimHistory(history);
      this.conversations.set(id, history);

      return { reply, conversationId: id };
    } catch (error) {
      console.error('OpenAI request failed:', error);
      throw new BadGatewayException(
        'The AI service could not respond right now. Please try again in a moment.',
      );
    }
  }

  private trimHistory(history: OpenAI.Chat.ChatCompletionMessageParam[]): void {
    if (history.length <= MAX_HISTORY_MESSAGES) {
      return;
    }
    const systemMessage = history[0];
    const recent = history.slice(-(MAX_HISTORY_MESSAGES - 1));
    history.splice(0, history.length, systemMessage, ...recent);
  }

  private runTool(toolCall: OpenAI.Chat.ChatCompletionMessageToolCall): string {
    if (toolCall.type !== 'function') {
      return `Error: unsupported tool call type "${toolCall.type}".`;
    }
    if (toolCall.function.name !== 'calculator') {
      return `Error: unknown tool "${toolCall.function.name}".`;
    }

    try {
      const args = JSON.parse(toolCall.function.arguments) as { expression?: string };
      if (!args.expression) {
        return 'Error: no expression was provided.';
      }
      return runCalculator(args.expression);
    } catch {
      return 'Error: could not parse the tool arguments.';
    }
  }
}
