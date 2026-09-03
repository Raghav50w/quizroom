import type { Quiz } from "../../shared/quiz.js";

/** Server-shaped errors, so screens can show the message the server chose. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      body.message ?? "Something went wrong.",
      body.error ?? "unknown",
      response.status,
    );
  }

  return (await response.json()) as T;
}

/** Draft only — nothing is stored until the reviewed quiz is posted. */
export function generateQuiz(source: string, count: number) {
  return request<{ quiz: Quiz; shortfall: { requested: number; delivered: number } | null }>(
    "/generate",
    { method: "POST", body: JSON.stringify({ source, count }) },
  );
}

export function saveQuiz(quiz: Pick<Quiz, "title" | "sourceMode" | "questions">) {
  return request<{ quiz: Quiz }>("/quizzes", {
    method: "POST",
    body: JSON.stringify(quiz),
  });
}

export function fetchQuiz(id: string) {
  return request<{ quiz: Quiz }>(`/quizzes/${id}`);
}

export type PdfStep = "reading" | "generating" | "done" | "failed";

export interface PdfJob {
  step: PdfStep;
  quiz: Quiz | null;
  shortfall: { requested: number; delivered: number } | null;
  error: string | null;
}

/**
 * Starts a PDF job and returns its id. Deliberately not using `request()`.
 *
 * `request()` hardcodes `Content-Type: application/json` on every call. A file
 * upload sends FormData, and the browser must set that header itself so it can
 * append the multipart boundary — setting it by hand produces a parse failure
 * on the server that reads like a corrupt file. So: plain fetch, no headers.
 */
export async function uploadPdf(
  file: File,
  count: number,
  prompt: string,
): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("count", String(count));
  form.append("prompt", prompt);

  const response = await fetch("/api/pdf", { method: "POST", body: form });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      body.message ?? "Something went wrong.",
      body.error ?? "unknown",
      response.status,
    );
  }

  return (await response.json()) as { jobId: string };
}

/** Polled while the job runs. Plain JSON, so `request()` is fine here. */
export function fetchPdfJob(jobId: string) {
  return request<PdfJob>(`/pdf/${jobId}`);
}

/** Keeps the free-tier box awake while the create form is open. */
export function ping() {
  return fetch("/healthz").catch(() => undefined);
}
