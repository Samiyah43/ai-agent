import { runWebSearch } from './web-search.tool';

describe('runWebSearch', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns an error when no query is provided', async () => {
    const result = await runWebSearch('   ', 'fake-key');
    expect(result).toBe('Error: no search query was provided.');
  });

  it('returns an error when no API key is configured', async () => {
    const result = await runWebSearch('latest news', undefined);
    expect(result).toContain('not configured');
  });

  it('formats a successful response with an answer and sources', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Bitcoin is around $65,000.',
        results: [
          { title: 'BTC Price', url: 'https://example.com/btc', content: 'Bitcoin price update.' },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await runWebSearch('bitcoin price', 'fake-key');

    expect(result).toContain('Summary: Bitcoin is around $65,000.');
    expect(result).toContain('BTC Price (https://example.com/btc)');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns a "no results" message when the API returns an empty list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }) as unknown as typeof fetch;

    const result = await runWebSearch('something obscure', 'fake-key');
    expect(result).toBe('No web results found for "something obscure".');
  });

  it('returns an error when the API responds with a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;

    const result = await runWebSearch('bitcoin price', 'bad-key');
    expect(result).toBe('Error: web search failed with status 401.');
  });

  it('returns an error when the fetch call throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await runWebSearch('bitcoin price', 'fake-key');
    expect(result).toBe('Error: could not complete web search for "bitcoin price".');
  });
});
