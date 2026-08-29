/**
 * Retry primitives shared by the chat and embedding calls.
 *
 * Extracted from llm.ts when the embedding endpoint needed exactly the same
 * behaviour — same provider, same 429s, same transport failures. Two copies of
 * a backoff loop drift, and the one that drifts is the one without tests.
 *
 * Pure and dependency-free. Lives in generator/ so both it and server/rag can
 * import it; the dependency only ever points this way.
 */

export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_ATTEMPTS = 4;
export const BASE_BACKOFF_MS = 500;

/** Retry on transport failures, 429, and 5xx. A 400 is our bug — don't retry it. */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Exponential backoff with full jitter, so parallel retries don't sync up. */
export function backoffMs(attempt: number): number {
  return Math.random() * BASE_BACKOFF_MS * 2 ** attempt;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Per-request timeout, combined with the caller's cancellation if there is one. */
export function requestSignal(caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return caller ? AbortSignal.any([timeout, caller]) : timeout;
}
