import { chunkText } from './text-chunker';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkText('Hello world.')).toEqual(['Hello world.']);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\t  ')).toEqual([]);
  });

  it('splits long text into overlapping chunks', () => {
    const text = 'a'.repeat(2000);

    const chunks = chunkText(text, 800, 150);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk except the last should be exactly chunkSize long.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBe(800);
    }
    // Consecutive chunks should overlap by the requested amount.
    expect(chunks[0].slice(-150)).toBe(chunks[1].slice(0, 150));
  });

  it('collapses internal whitespace before chunking', () => {
    const chunks = chunkText('Hello    world.\n\nSecond   line.');

    expect(chunks).toEqual(['Hello world. Second line.']);
  });
});
