// @xenova/transformers is an ESM-only package, but this project compiles to
// CommonJS. A dynamic import() (instead of a static import) is how CJS code
// loads an ESM package at runtime.
type Embedder = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

let embedderPromise: Promise<Embedder> | null = null;

// Loading the model is slow (seconds) and only needs to happen once, so it's
// cached in this module-level promise instead of being reloaded per call.
function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')) as unknown as Embedder;
    })();
  }
  return embedderPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
