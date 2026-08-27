/**
 * Cleaned text -> overlapping windows.
 *
 * Characters, not tokens: a tokeniser is a dependency and a model download to
 * decide where to cut a string, and the downstream budget (4 chunks, ~12,000
 * chars against a 15,000 cap) has enough headroom that the imprecision is free.
 *
 * The overlap exists so a fact split across a boundary survives in one piece on
 * at least one side.
 */

export const CHUNK_SIZE = 3_000;
export const CHUNK_OVERLAP = 400;

export interface Chunk {
  /** Position in the document. Retrieval re-sorts by this so the model reads in order. */
  ordinal: number;
  text: string;
}

export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): Chunk[] {
  if (text.trim() === "") return [];

  const stride = size - overlap;
  const chunks: Chunk[] = [];

  for (let start = 0; start < text.length; start += stride) {
    // A trailing window shorter than the overlap is wholly contained in its
    // predecessor — it would be a duplicate embedding of text already covered.
    if (start > 0 && text.length - start <= overlap) break;
    chunks.push({ ordinal: chunks.length, text: text.slice(start, start + size) });
  }

  return chunks;
}
