import { nanoid } from "nanoid";
import { config } from "../config.js";
import { generateQuiz } from "../generator/index.js";
import type { Quiz } from "../shared/quiz.js";

/**
 * The whole PDF path on the Node side:
 *
 *   1. jobs        an in-memory map the client polls
 *   2. runPdfJob   the job itself, run detached from the request
 *   3. RAG client  the two HTTP calls to the Python service in rag/
 */

// ---------------------------------------------------------------------------
// 1. Jobs
// ---------------------------------------------------------------------------

/**
 * A PDF takes 10-60 seconds — reading it in the RAG service, then generation —
 * which is longer than a held-open request reliably survives behind a proxy, so
 * the route returns an id immediately and the client polls.
 *
 * In-memory on purpose: a handful of entries at a time, and a restart clearing
 * them is correct behaviour, not data loss. No eviction timer for the same
 * reason — there is nothing here worth reaping.
 */

/**
 * Only the two phases Node can actually observe.
 *
 * The RAG service extracts, chunks and embeds inside a single `/ingest` call,
 * so there is no moment where Node could truthfully say "chunking" — reporting
 * it would be a progress bar that moves on a timer rather than on the work.
 */
export type JobStep = "reading" | "generating" | "done" | "failed";

/** Only the failures the client says something specific about. */
export type JobError =
  | "no_text_found"
  | "file_too_large"
  | "too_many_pages"
  | "generation_failed";

export interface Job {
  step: JobStep;
  result?: Quiz;
  error?: JobError;
  shortfall?: { requested: number; delivered: number };
}

const jobs = new Map<string, Job>();

export function createJob(): string {
  const id = nanoid(12);
  jobs.set(id, { step: "reading" });
  return id;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Ignores an unknown id: a terminal state may race a restart that cleared the map. */
function setStep(id: string, step: JobStep): void {
  const job = jobs.get(id);
  if (job) job.step = step;
}

function finishJob(id: string, result: Quiz, shortfall?: Job["shortfall"]): void {
  const job: Job = { step: "done", result };
  if (shortfall) job.shortfall = shortfall;
  jobs.set(id, job);
}

function failJob(id: string, error: JobError): void {
  jobs.set(id, { step: "failed", error });
}

// ---------------------------------------------------------------------------
// 2. The job
// ---------------------------------------------------------------------------

/**
 * Everything is inside one try/catch that always writes a terminal state. A
 * rejection escaping a floating promise is an unhandled rejection — on a free
 * instance that reads as the site randomly 404ing, the same failure the pool
 * error handler in db/index.ts already guards against.
 */
export async function runPdfJob(
  jobId: string,
  file: Buffer,
  prompt: string | null,
  count: number,
  filename: string,
): Promise<void> {
  try {
    // One call covers extraction, chunking and embedding — see JobStep.
    setStep(jobId, "reading");
    const { documentId } = await ingestPdf(file, filename);
    const source = await selectSource(documentId, prompt);

    setStep(jobId, "generating");
    const focus = prompt?.trim() || "";
    const { quiz, shortfall } = await generateQuiz({
      source,
      count,
      sourceMode: "pdf",
      // A retrieved excerpt starts mid-sentence, so the generator's
      // derive-from-first-line fallback would produce a title like "ng losses.
      // In contrast,". The focus is what the user meant; with none, Review
      // requires them to name it before saving anyway.
      title: focus || titleFromFilename(filename),
      prompt: focus || undefined,
      log: (message) => console.warn(`[pdf ${jobId}] ${message}`),
    });

    finishJob(jobId, quiz, shortfall);
  } catch (error) {
    console.error(`[pdf ${jobId}] failed:`, error);
    failJob(jobId, toJobError(error));
  }
}

/** "Intro_to_Cell-Biology.pdf" -> "Intro to Cell Biology". */
function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return stem.slice(0, 120) || "Untitled quiz";
}

/**
 * The service's codes are the client's codes, except `unknown_document` and
 * `unavailable` — both mean the pipeline broke rather than the file being bad,
 * and the user can do nothing with that distinction.
 */
function toJobError(error: unknown): JobError {
  const message = error instanceof Error ? error.message : "";
  if (message === "no_text_found" || message === "file_too_large" || message === "too_many_pages") {
    return message;
  }
  return "generation_failed";
}

// ---------------------------------------------------------------------------
// 3. RAG client
// ---------------------------------------------------------------------------

/**
 * Everything PDF- and embedding-shaped lives in Python (rag/). This is the
 * only place that knows the service exists — two calls, kept separate so a
 * caller can report which step a job is on, since ingest takes seconds and a
 * user watching a spinner should be told which one is running.
 */

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
 * problem rather than a bad PDF. A non-OK response carries the service's error
 * code as its message, which `toJobError` maps to the client's copy.
 */
async function call(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(serviceUrl(path), {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        // Measured, not defensive. Reusing a keep-alive socket against uvicorn
        // after the multipart upload wedges the *next* request: the server
        // accepts one reuse, answers it, then never parses anything more on
        // that socket. Three ingest+select pairs from one process scored 1/3
        // with keep-alive (run 2's select and run 3's ingest both hung to the
        // 120s ceiling, with no matching line in the uvicorn access log) and
        // 3/3 with this header. A fresh TCP connection to localhost costs
        // nothing next to a ~2.5s embed.
        connection: "close",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(
      `Could not reach the RAG service at ${config.RAG_SERVICE_URL}: ${(cause as Error).message}`,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? "unavailable");
  }

  return response.json();
}

export interface IngestResult {
  documentId: string;
  chunks: number;
}

/** Extract, clean, chunk, embed, and store. Returns the id to retrieve by. */
export async function ingestPdf(file: Buffer, filename: string): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)]), filename);

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
