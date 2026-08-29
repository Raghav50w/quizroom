import { config } from "../config.js";
import {
  MAX_ATTEMPTS,
  backoffMs,
  isRetryable,
  requestSignal,
  sleep,
} from "./retry.js";

/**
 * The single LLM call. One function, one endpoint, no adapters.
 *
 * Two timeouts, both load-bearing: a per-request AbortController timeout so one
 * hung connection can't hold a generation slot forever, and a total-job deadline
 * so retries can't stack up past it.
 */

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface CallOptions {
  /** Absolute epoch ms after which no further attempt starts. */
  deadlineAt?: number;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: CallOptions = {},
): Promise<string> {
  const url = new URL("chat/completions", ensureTrailingSlash(config.LLM_BASE_URL));
  let lastError: LlmError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      throw new LlmError("Generation deadline exceeded");
    }

    const signal = requestSignal(options.signal);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.LLM_MODEL,
          temperature: 0.7,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new LlmError(
          `LLM returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
        if (!isRetryable(response.status)) throw error;
        lastError = error;
      } else {
        const payload = (await response.json()) as ChatCompletionResponse;
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim() === "") {
          throw new LlmError("LLM returned an empty completion");
        }
        return content;
      }
    } catch (cause) {
      if (cause instanceof LlmError) {
        // Non-retryable statuses and empty completions surface immediately.
        if (cause.status === undefined || !isRetryable(cause.status)) throw cause;
        lastError = cause;
      } else if (options.signal?.aborted) {
        throw new LlmError("Generation aborted");
      } else {
        // Network failure or request timeout — worth another attempt.
        lastError = new LlmError(`LLM request failed: ${(cause as Error).message}`);
      }
    }

    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt));
  }

  throw lastError ?? new LlmError("LLM call failed");
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}
