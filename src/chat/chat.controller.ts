import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ClientThrottlerGuard } from '../auth/client-throttler.guard';
import { CurrentClient } from '../auth/current-client.decorator';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard, ClientThrottlerGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message to the agent and get a reply' })
  async createReply(@Body() body: ChatRequestDto, @CurrentClient() clientId: number) {
    return this.chatService.createReply(clientId, body.message, body.conversationId);
  }
}
