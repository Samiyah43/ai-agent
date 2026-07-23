import OpenAI from 'openai';

export const webSearchToolDefinition: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Searches the live web for current, real-time, or recent information (news, prices, events, releases, anything after your training cutoff or that changes over time). Use this whenever the user asks about something current or recent that is not in the knowledge base.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, e.g. "latest Bitcoin price" or "Pakistan weather news today"',
        },
      },
      required: ['query'],
    },
  },
};

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export async function runWebSearch(query: string, apiKey: string | undefined): Promise<string> {
  if (!query.trim()) {
    return 'Error: no search query was provided.';
  }

  if (!apiKey) {
    return 'Error: web search is not configured. Add TAVILY_API_KEY to your .env file and restart the server.';
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      return `Error: web search failed with status ${response.status}.`;
    }

    const data = (await response.json()) as TavilyResponse;

    if (!data.results?.length) {
      return `No web results found for "${query}".`;
    }

    const formattedResults = data.results
      .map((result, index) => `${index + 1}. ${result.title} (${result.url})\n${result.content}`)
      .join('\n\n');

    const summary = data.answer ? `Summary: ${data.answer}\n\n` : '';
    return `${summary}Sources:\n${formattedResults}`;
  } catch {
    return `Error: could not complete web search for "${query}".`;
  }
}
