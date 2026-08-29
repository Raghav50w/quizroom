import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Chunk } from "../../generator/pdf/chunk.js";
import { db, schema } from "../db/index.js";
import { embed } from "./embed.js";

/**
 * Chunks in and out of Postgres. Imports `db` directly — no ChunkStore
 * interface, no injection. The split that matters is by dependency: pure PDF
 * work lives in generator/pdf, and anything needing the database lives here.
 */

export interface StoredChunk {
  ordinal: number;
  text: string;
}

/**
 * Embeds and stores a document's chunks. Returns the document id to retrieve by.
 *
 * One insert: a half-stored document would answer queries with a silent subset
 * of itself, which reads as bad retrieval rather than as a failure.
 */
export async function storeChunks(
  chunks: Chunk[],
  onWait?: (ms: number) => void,
): Promise<string> {
  const documentId = nanoid(12);
  const vectors = await embed(
    chunks.map((chunk) => chunk.text),
    onWait,
  );

  await db.insert(schema.chunks).values(
    chunks.map((chunk, i) => ({
      id: nanoid(16),
      documentId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      embedding: vectors[i]!,
    })),
  );

  return documentId;
}

export async function listChunks(documentId: string): Promise<StoredChunk[]> {
  return db
    .select({ ordinal: schema.chunks.ordinal, text: schema.chunks.text })
    .from(schema.chunks)
    .where(eq(schema.chunks.documentId, documentId))
    .orderBy(schema.chunks.ordinal);
}
