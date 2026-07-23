import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { embedText } from './embeddings';
import { KnowledgeBaseService } from './knowledge-base.service';

jest.mock('./embeddings', () => ({
  embedText: jest.fn(),
}));

const mockEmbedText = embedText as jest.Mock;

const CLIENT_ID = 1;

// A tiny in-memory stand-in for PrismaService, matching the style used in
// chat.service.spec.ts's createFakePrisma().
function createFakePrisma() {
  const documents: { id: number; clientId: number; title: string; content: string }[] = [];
  const chunks: { id: number; documentId: number; content: string; embedding: string }[] = [];
  let nextDocumentId = 1;
  let nextChunkId = 1;

  const prisma = {
    document: {
      create: jest.fn(async ({ data }: { data: { clientId: number; title: string; content: string } }) => {
        const row = { id: nextDocumentId++, ...data };
        documents.push(row);
        return row;
      }),
    },
    chunk: {
      create: jest.fn(async ({ data }: { data: { documentId: number; content: string; embedding: string } }) => {
        const row = { id: nextChunkId++, ...data };
        chunks.push(row);
        return row;
      }),
    },
  } as unknown as PrismaService;

  return { prisma, documents, chunks };
}

describe('KnowledgeBaseService', () => {
  beforeEach(() => {
    mockEmbedText.mockReset();
    mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('chunks, embeds, and stores a document', async () => {
    const { prisma, documents, chunks } = createFakePrisma();
    const service = new KnowledgeBaseService(prisma);

    const result = await service.ingestDocument(CLIENT_ID,'Refund Policy', 'Refunds are available within 30 days.');

    expect(documents).toHaveLength(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].documentId).toBe(documents[0].id);
    expect(JSON.parse(chunks[0].embedding)).toEqual([0.1, 0.2, 0.3]);
    expect(result).toEqual({ documentId: documents[0].id, chunkCount: 1 });
  });

  it('creates one chunk row per chunk for long content', async () => {
    const { prisma, chunks } = createFakePrisma();
    const service = new KnowledgeBaseService(prisma);

    const result = await service.ingestDocument(CLIENT_ID,'Long Doc', 'a'.repeat(2000));

    expect(result.chunkCount).toBeGreaterThan(1);
    expect(chunks).toHaveLength(result.chunkCount);
    expect(mockEmbedText).toHaveBeenCalledTimes(result.chunkCount);
  });

  it('throws BadRequestException for empty content', async () => {
    const { prisma } = createFakePrisma();
    const service = new KnowledgeBaseService(prisma);

    await expect(service.ingestDocument(CLIENT_ID,'Empty Doc', '   ')).rejects.toBeInstanceOf(BadRequestException);
  });
});
