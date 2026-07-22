import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';

@Module({
  controllers: [ChatController, KnowledgeBaseController],
  providers: [ChatService, KnowledgeBaseService, PrismaService, ApiKeyGuard],
})
export class ChatModule {}
