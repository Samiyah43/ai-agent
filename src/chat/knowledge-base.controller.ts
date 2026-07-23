import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ClientThrottlerGuard } from '../auth/client-throttler.guard';
import { CurrentClient } from '../auth/current-client.decorator';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { extractPdfText } from './pdf-extractor';

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

@ApiTags('knowledge-base')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard, ClientThrottlerGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Post('documents')
  @ApiOperation({ summary: 'Ingest a document from raw text' })
  async ingest(@Body() body: IngestDocumentDto, @CurrentClient() clientId: number) {
    return this.knowledgeBaseService.ingestDocument(clientId, body.title, body.content);
  }

  @Post('documents/upload')
  @ApiOperation({ summary: 'Ingest a document by uploading a PDF' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_SIZE_BYTES } }))
  async ingestPdf(
    @UploadedFile() file: Express.Multer.File,
    @CurrentClient() clientId: number,
    @Body('title') title?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded. Send it as form-data under the "file" field.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are supported.');
    }

    const text = await extractPdfText(file.buffer);
    const documentTitle = title?.trim() || file.originalname.replace(/\.pdf$/i, '');

    return this.knowledgeBaseService.ingestDocument(clientId, documentTitle, text);
  }
}
