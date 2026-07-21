import { PrismaService } from '../../prisma/prisma.service';
import { embedText } from '../embeddings';
import { runKnowledgeBase } from './knowledge-base.tool';

jest.mock('../embeddings', () => ({
  embedText: jest.fn(),
}));

const mockEmbedText = embedText as jest.Mock;

interface FakeChunkRow {
  content: string;
  embedding: string;
  document: { title: string };
}

function createFakePrisma(chunks: FakeChunkRow[] | Error): PrismaService {
  return {
    chunk: {
      findMany: jest.fn(async () => {
        if (chunks instanceof Error) {
          throw chunks;
        }
        return chunks;
      }),
    },
  } as unknown as PrismaService;
}

describe('runKnowledgeBase', () => {
  beforeEach(() => {
    mockEmbedText.mockReset();
  });

  it('returns an error when no query is provided', async () => {
    const result = await runKnowledgeBase('   ', createFakePrisma([]));

    expect(result).toBe('Error: no query was provided.');
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('returns an error when the knowledge base is empty', async () => {
    const result = await runKnowledgeBase('refund policy', createFakePrisma([]));

    expect(result).toBe('Error: the knowledge base is empty. No documents have been ingested yet.');
  });

  it('ranks the most similar chunk first', async () => {
    mockEmbedText.mockResolvedValue([1, 0]);
    const prisma = createFakePrisma([
      { content: 'Unrelated cooking tips.', embedding: JSON.stringify([0, 1]), document: { title: 'Recipes' } },
      { content: 'Refunds within 30 days.', embedding: JSON.stringify([1, 0]), document: { title: 'Refund Policy' } },
    ]);

    const result = await runKnowledgeBase('refund policy', prisma);

    expect(result.startsWith('[1] From "Refund Policy" (similarity 1.00):\nRefunds within 30 days.')).toBe(true);
  });

  it('returns an error when no chunk is relevant enough', async () => {
    mockEmbedText.mockResolvedValue([1, 0]);
    const prisma = createFakePrisma([
      { content: 'Unrelated cooking tips.', embedding: JSON.stringify([0, 1]), document: { title: 'Recipes' } },
    ]);

    const result = await runKnowledgeBase('refund policy', prisma);

    expect(result).toBe('Error: no relevant information was found in the knowledge base for that query.');
  });

  it('returns a generic error when the search fails unexpectedly', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runKnowledgeBase('refund policy', createFakePrisma(new Error('db down')));

    expect(result).toBe('Error: could not search the knowledge base right now.');
  });
});
