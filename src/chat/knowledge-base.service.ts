import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { embedText } from './embeddings';
import { chunkText } from './text-chunker';

export interface IngestResult {
  documentId: number;
  chunkCount: number;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestDocument(clientId: number, title: string, content: string): Promise<IngestResult> {
    const chunks = chunkText(content);
    if (!chunks.length) {
      throw new BadRequestException('The document has no content to ingest.');
    }

    const document = await this.prisma.document.create({ data: { clientId, title, content } });

    // Embedding each chunk calls the local model, which is CPU-bound — doing
    // this one at a time (instead of Promise.all) keeps it simple and avoids
    // overloading the CPU with concurrent inference calls.
    for (const chunkContent of chunks) {
      const embedding = await embedText(chunkContent);
      await this.prisma.chunk.create({
        data: { documentId: document.id, content: chunkContent, embedding: JSON.stringify(embedding) },
      });
    }

    return { documentId: document.id, chunkCount: chunks.length };
  }
}
