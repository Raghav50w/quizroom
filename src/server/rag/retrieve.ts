import { cosineDistance, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { embed } from "./embed.js";
import { evenSample, sortByOrdinal } from "./sample.js";
import { listChunks, type StoredChunk } from "./store.js";

/**
 * Which part of a document the questions get written from.
 *
 * Four chunks, ~12,000 characters. Five would be exactly the 15,000-char source
 * cap with zero headroom, and sitting precisely on a boundary is how a confusing
 * failure arrives later.
 */
const CHUNKS_PER_PROMPT = 4;

/** Ordinal order, so the model reads the excerpts the way the document runs. */
function joinInOrder(chunks: StoredChunk[]): string {
  return [...chunks]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((chunk) => chunk.text)
    .join("\n\n");
}

/**
 * The source string for `generateQuiz`.
 *
 * With a topic this is real vector search. Without one it is even sampling —
 * index arithmetic that never touches pgvector. Both paths return the same
 * shape, so the caller doesn't branch.
 */
export async function selectSource(documentId: string, topic: string | null): Promise<string> {
  if (topic === null || topic.trim() === "") {
    return joinInOrder(evenSample(await listChunks(documentId), CHUNKS_PER_PROMPT));
  }

  const [queryVector] = await embed([topic.trim()]);

  const rows = await db
    .select({ ordinal: schema.chunks.ordinal, text: schema.chunks.text })
    .from(schema.chunks)
    .where(eq(schema.chunks.documentId, documentId))
    .orderBy(cosineDistance(schema.chunks.embedding, queryVector!))
    .limit(CHUNKS_PER_PROMPT);

  return joinInOrder(rows);
}
