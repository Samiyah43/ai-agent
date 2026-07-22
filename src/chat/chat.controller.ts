import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message to the agent and get a reply' })
  async createReply(@Body() body: ChatRequestDto) {
    return this.chatService.createReply(body.message, body.conversationId);
  }
}
