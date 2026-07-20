import { Body, Controller, Post } from '@nestjs/common';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async createReply(@Body() body: ChatRequestDto) {
    const reply = await this.chatService.createReply(body.message);
    return { reply };
  }
}
