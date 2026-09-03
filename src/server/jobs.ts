import { nanoid } from "nanoid";
import type { Quiz } from "../shared/quiz.js";

/**
 * PDF jobs, in a plain Map.
 *
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
export function setStep(id: string, step: JobStep): void {
  const job = jobs.get(id);
  if (job) job.step = step;
}

export function finishJob(id: string, result: Quiz, shortfall?: Job["shortfall"]): void {
  jobs.set(id, { step: "done", result, ...(shortfall ? { shortfall } : {}) });
}

export function failJob(id: string, error: JobError): void {
  jobs.set(id, { step: "failed", error });
}
