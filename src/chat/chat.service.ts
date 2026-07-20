import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

const CHATBOT_INSTRUCTIONS = [
  'You are a helpful, beginner-friendly AI chatbot.',
  'Reply clearly and honestly.',
  'Use short sections or steps when they make an explanation easier to follow.',
  'If the user writes in Roman Urdu, reply in Roman Urdu unless they ask for another language.',
].join(' ');

@Injectable()
export class ChatService {
  private readonly client: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
  }

  async createReply(message: string): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OpenAI is not configured. Add OPENAI_API_KEY to your .env file and restart the server.',
      );
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-5-mini',
        messages: [
          { role: 'system', content: CHATBOT_INSTRUCTIONS },
          { role: 'user', content: message },
        ],
      });

      return (
        response.choices[0]?.message?.content ||
        'Sorry, I could not generate a reply. Please try again.'
      );
    } catch (error) {
      console.error('OpenAI request failed:', error);
      throw new BadGatewayException(
        'The AI service could not respond right now. Please try again in a moment.',
      );
    }
  }
}
