import type { Quiz } from "../../shared/quiz.js";

/**
 * Every error thrown from here carries a message the screen can show as is:
 * the server's own copy when it answered, or a fixed line when it didn't.
 */
async function throwFromResponse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  throw new Error(body.message ?? "Something went wrong.");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error("Could not reach the server.");
  }

  if (!response.ok) await throwFromResponse(response);

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

  let response: Response;
  try {
    response = await fetch("/api/pdf", { method: "POST", body: form });
  } catch {
    throw new Error("Could not reach the server.");
  }

  if (!response.ok) await throwFromResponse(response);

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
