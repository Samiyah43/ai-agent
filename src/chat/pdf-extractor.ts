import { PDFParse } from 'pdf-parse';

// Wraps pdf-parse's parser lifecycle (construct -> getText -> destroy) so
// callers just hand over a buffer and get plain text back.
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
