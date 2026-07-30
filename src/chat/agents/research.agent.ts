import { knowledgeBaseToolDefinition } from '../tools/knowledge-base.tool';
import { webSearchToolDefinition } from '../tools/web-search.tool';
import { AgentDefinition } from './agent.types';

// Small/free models often "think" they already know the answer to questions like
// this and skip web_search despite the system prompt, then answer from stale
// training data. Rather than relying entirely on the model's own judgement, these
// keywords force a web_search on the first round as a deterministic fallback.
const CURRENT_INFO_PATTERN =
  /\b(compare|comparison|vs\.?|versus|which is better|latest|newest|current|price|pricing|news|update|release|version)\b|\b(aaj|abhi|taza|khabar|keemat)\b/i;

export function needsWebSearch(message: string): boolean {
  return CURRENT_INFO_PATTERN.test(message);
}

export const researchAgent: AgentDefinition = {
  name: 'research',
  systemPrompt: [
    'You are the Research Agent inside a multi-agent assistant. You answer factual, informational, and knowledge questions.',
    'If the user writes in Roman Urdu, reply in Roman Urdu unless they ask for another language.',
    'For any question that could plausibly be about a company policy, procedure, or other topic that might be documented (e.g. leave, remote work, security, benefits, "the document", "this file"), you must call search_knowledge_base first. Never rely on your own general/textbook knowledge for these topics, even if you think you already know a typical answer — the user only wants what is actually in their own uploaded documents. Only ask the user to clarify if the tool returns no relevant results.',
    'When you answer using results from the search_knowledge_base tool, only state facts that are explicitly present in those results.',
    'Do not add extra steps, numbers, features, or claims that are not in the retrieved text, even if they sound plausible.',
    'If the retrieved text does not fully answer the question, say what it does cover and clearly note that the rest is not in the knowledge base.',
    'For questions about current events, recent news, live prices, or anything that changes over time or could be after your training cutoff, call web_search instead of answering from memory. This includes comparisons or facts about specific products, companies, tools, or technologies (e.g. "compare X and Y", "which is better", specs, pricing, version numbers) — these change often and your own knowledge of them may be outdated or wrong, so verify with web_search rather than guessing.',
    'When you answer using web_search results, end your reply with a "Sources" section listing the URLs from the tool results, so the user can verify the information themselves.',
  ].join(' '),
  tools: [knowledgeBaseToolDefinition, webSearchToolDefinition],
};
