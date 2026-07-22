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
import { ApiKeyGuard } from '../auth/api-key.guard';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { extractPdfText } from './pdf-extractor';

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

@UseGuards(ApiKeyGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Post('documents')
  async ingest(@Body() body: IngestDocumentDto) {
    return this.knowledgeBaseService.ingestDocument(body.title, body.content);
  }

  @Post('documents/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_SIZE_BYTES } }))
  async ingestPdf(@UploadedFile() file: Express.Multer.File, @Body('title') title?: string) {
    if (!file) {
      throw new BadRequestException('No file was uploaded. Send it as form-data under the "file" field.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are supported.');
    }

    const text = await extractPdfText(file.buffer);
    const documentTitle = title?.trim() || file.originalname.replace(/\.pdf$/i, '');

    return this.knowledgeBaseService.ingestDocument(documentTitle, text);
  }
}
