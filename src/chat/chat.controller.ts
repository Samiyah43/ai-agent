import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatService } from './chat.service';

@UseGuards(ApiKeyGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async createReply(@Body() body: ChatRequestDto) {
    return this.chatService.createReply(body.message, body.conversationId);
  }
}
