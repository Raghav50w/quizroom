import { readFile, stat } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * PDF path -> one string per page.
 *
 * Text layer only. A scanned PDF is a stack of images with no text to extract,
 * and OCR is explicitly out of scope — those get rejected with `no_text_found`
 * rather than silently producing an empty quiz.
 *
 * Pages stay separate because cleaning needs the boundaries: running headers are
 * only detectable as "this line appears on most pages".
 */

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;

export type PdfErrorCode = "file_too_large" | "too_many_pages" | "no_text_found";

export class PdfError extends Error {
  constructor(
    message: string,
    readonly code: PdfErrorCode,
  ) {
    super(message);
    this.name = "PdfError";
  }
}

export async function extractPages(path: string): Promise<string[]> {
  // Size first: rejecting a 200MB file shouldn't require reading 200MB.
  const { size } = await stat(path);
  if (size > MAX_PDF_BYTES) {
    throw new PdfError(
      `PDF is ${(size / 1024 / 1024).toFixed(1)}MB, limit is ${MAX_PDF_BYTES / 1024 / 1024}MB`,
      "file_too_large",
    );
  }

  const bytes = new Uint8Array(await readFile(path));
  const pdf = await getDocumentProxy(bytes);

  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new PdfError(
      `PDF has ${pdf.numPages} pages, limit is ${MAX_PDF_PAGES}`,
      "too_many_pages",
    );
  }

  const { text } = await extractText(pdf, { mergePages: false });

  if (text.every((page) => page.trim() === "")) {
    throw new PdfError("No text layer found — scanned PDFs are not supported", "no_text_found");
  }

  return text;
}
