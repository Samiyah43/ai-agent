import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../../prisma/prisma.service';
import { embedText } from '../embeddings';

const logger = new Logger('KnowledgeBaseTool');

export const knowledgeBaseToolDefinition: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description:
      'Searches previously ingested documents (e.g. policies, notes, product docs) for information relevant to a question. Use this whenever the user asks something that might be answered by uploaded documents rather than general knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question or topic to search for, e.g. "refund policy" or "how does the API authenticate?"',
        },
      },
      required: ['query'],
    },
  },
};

// Exported so ChatService can detect these exact outcomes and force a
// guaranteed "I don't know" reply instead of letting the model decide
// whether to follow that instruction — see the no-hallucination guardrail
// in chat.service.ts.
export const KB_EMPTY_ERROR = 'Error: the knowledge base is empty. No documents have been ingested yet.';
export const KB_NO_MATCH_ERROR = 'Error: no relevant information was found in the knowledge base for that query.';

const TOP_MATCHES = 3;
// Cosine similarity ranges from -1 to 1; below this, a match is probably
// unrelated noise rather than a genuine answer. Kept fairly low because the
// embedding model is mostly English-trained, so Roman Urdu / mixed-language
// queries score lower against English content even when the topic matches.
const MIN_RELEVANCE_SCORE = 0.2;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function runKnowledgeBase(query: string, clientId: number, prisma: PrismaService): Promise<string> {
  if (!query.trim()) {
    return 'Error: no query was provided.';
  }

  try {
    const chunks = await prisma.chunk.findMany({
      where: { document: { clientId } },
      include: { document: true },
    });
    if (!chunks.length) {
      return KB_EMPTY_ERROR;
    }

    const queryEmbedding = await embedText(query);
    const ranked = chunks
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, JSON.parse(chunk.embedding) as number[]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_MATCHES);

    if (!ranked.length || ranked[0].score < MIN_RELEVANCE_SCORE) {
      return KB_NO_MATCH_ERROR;
    }

    return ranked
      .map((r, i) => `[${i + 1}] From "${r.chunk.document.title}" (similarity ${r.score.toFixed(2)}):\n${r.chunk.content}`)
      .join('\n\n');
  } catch (error) {
    logger.error('Knowledge base search failed', error instanceof Error ? error.stack : error);
    return 'Error: could not search the knowledge base right now.';
  }
}
