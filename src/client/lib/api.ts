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

/** Keeps the free-tier box awake while the create form is open. */
export function ping() {
  return fetch("/healthz").catch(() => undefined);
}
