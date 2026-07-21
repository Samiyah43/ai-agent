import { Body, Controller, Post } from '@nestjs/common';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { KnowledgeBaseService } from './knowledge-base.service';

@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Post('documents')
  async ingest(@Body() body: IngestDocumentDto) {
    return this.knowledgeBaseService.ingestDocument(body.title, body.content);
  }
}
