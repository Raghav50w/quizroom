import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "../config.js";

/**
 * The Node side of the RAG service.
 *
 * Everything PDF- and embedding-shaped lives in Python (rag/). This is the
 * only place that knows the service exists — two calls, kept separate so a
 * caller can report which step a job is on, since ingest takes seconds and a
 * user watching a spinner should be told which one is running.
 *
 * Not in src/generator/: that folder imports nothing from src/server and has
 * no network dependencies, and this has one.
 */

/** Codes the service returns, which the client already has copy for. */
export type RagErrorCode =
  | "file_too_large"
  | "too_many_pages"
  | "no_text_found"
  | "unknown_document"
  | "unavailable";

export class RagError extends Error {
  constructor(
    message: string,
    readonly code: RagErrorCode,
  ) {
    super(message);
    this.name = "RagError";
  }
}

/** Embedding a 30-page PDF runs about a second; the ceiling is for a cold model load. */
const REQUEST_TIMEOUT_MS = 120_000;

function serviceUrl(path: string): URL {
  const base = config.RAG_SERVICE_URL.endsWith("/")
    ? config.RAG_SERVICE_URL
    : `${config.RAG_SERVICE_URL}/`;
  return new URL(path, base);
}

/**
 * A failed fetch here means the service is not running, which is a deployment
 * problem rather than a bad PDF — worth its own code so the message can say so.
 */
async function call(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(serviceUrl(path), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new RagError(
      `Could not reach the RAG service at ${config.RAG_SERVICE_URL}: ${(cause as Error).message}`,
      "unavailable",
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    const code = (body.detail ?? "unavailable") as RagErrorCode;
    throw new RagError(`RAG service returned ${response.status}: ${code}`, code);
  }

  return response.json();
}

export interface IngestResult {
  documentId: string;
  chunks: number;
}

/** Extract, clean, chunk, embed, and store. Returns the id to retrieve by. */
export async function ingestPdf(path: string): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", new Blob([await readFile(path)]), basename(path));

  // No Content-Type header: fetch sets it, with the multipart boundary. Setting
  // it by hand produces a parse failure that reads like a corrupt file.
  const payload = (await call("ingest", { method: "POST", body: form })) as {
    document_id: string;
    chunks: number;
  };

  return { documentId: payload.document_id, chunks: payload.chunks };
}

/**
 * The excerpt to write questions from.
 *
 * With a prompt this is cosine search; without one it is even sampling across
 * the document. Both return one string, so the caller never branches.
 */
export async function selectSource(documentId: string, prompt: string | null): Promise<string> {
  const payload = (await call("select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId, topic: prompt }),
  })) as { source: string };

  return payload.source;
}
