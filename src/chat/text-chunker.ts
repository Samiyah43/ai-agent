// Splits text into overlapping fixed-size chunks so each chunk is small
// enough to embed and retrieve individually, while the overlap keeps a
// sentence that falls on a chunk boundary readable in at least one chunk.
export function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + chunkSize, cleaned.length);
    chunks.push(cleaned.slice(start, end).trim());
    if (end === cleaned.length) {
      break;
    }
    start = end - overlap;
  }
  return chunks;
}
