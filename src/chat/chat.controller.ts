import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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

  // @Res() hands us the raw Express response so we can write it in pieces
  // instead of returning one JSON body — that's what makes this a stream.
  // Each ChatStreamEvent is sent as one SSE message: a "data: <json>\n\n"
  // line: the blank line at the end is what tells the client "this message
  // is complete". passthrough is left off (the default) because we're
  // handling the response ourselves, not asking Nest to also serialize a
  // return value on top of it.
  @Post('stream')
  @ApiOperation({ summary: 'Send a message and stream the agent\'s reply as Server-Sent Events' })
  async streamReply(
    @Body() body: ChatRequestDto,
    @CurrentClient() clientId: number,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const event of this.chatService.streamReply(clientId, body.message, body.conversationId)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.end();
  }
}
