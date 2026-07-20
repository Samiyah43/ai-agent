import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      name: 'AI Chatbot API',
      status: 'running',
      chatEndpoint: 'POST /chat',
    };
  }
}
