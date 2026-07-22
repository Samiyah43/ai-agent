import { extractPdfText } from './pdf-extractor';

const mockGetText = jest.fn();
const mockDestroy = jest.fn();

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

describe('extractPdfText', () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockDestroy.mockReset();
  });

  it('returns the extracted text', async () => {
    mockGetText.mockResolvedValue({ text: 'Hello from the PDF.' });

    const text = await extractPdfText(Buffer.from('fake-pdf-bytes'));

    expect(text).toBe('Hello from the PDF.');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('still destroys the parser when extraction fails', async () => {
    mockGetText.mockRejectedValue(new Error('corrupt PDF'));

    await expect(extractPdfText(Buffer.from('bad-bytes'))).rejects.toThrow('corrupt PDF');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
