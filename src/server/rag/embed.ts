import { config } from "../../config.js";
import { MAX_ATTEMPTS, backoffMs, isRetryable, requestSignal, sleep } from "../../generator/retry.js";

/**
 * Text -> 768-dimension vectors, via the same OpenAI-compatible endpoint and
 * key as the chat calls. Retry behaviour is shared with llm.ts, not reimplemented.
 */

/**
 * Pinned, and not configurable by env.
 *
 * Measured against the provider: omitting `dimensions` returns 3072, not 768.
 * This number must match `chunks.embedding` in the schema — if they drift, the
 * failure arrives as a database error after paying to embed a whole document.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Measured, not guessed. The free tier caps *tokens* per minute, not just
 * requests: 32 chunks of 3,000 chars is roughly 24,000 tokens in one call, and
 * two of those back to back exhausted the window on a 53-chunk document. 16
 * halves the burst so a normal document finishes without ever tripping it.
 */
const BATCH_SIZE = 16;

/**
 * A 429 here is a per-minute quota, so it needs a wait on that scale.
 *
 * The shared jittered backoff tops out near 8 seconds across all four attempts
 * — it can never outlast a 60-second window, so every retry burns an attempt
 * and fails identically. These are deliberately long enough to reach the next
 * window; the shared fast backoff still handles 5xx and transport blips.
 */
const QUOTA_BACKOFF_MS = [20_000, 40_000, 60_000];

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

/** Embeds every input, in order. One request per batch of BATCH_SIZE. */
export async function embed(
  inputs: string[],
  /** Told when a quota pause starts, so a 20s wait doesn't look like a hang. */
  onWait?: (ms: number) => void,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    vectors.push(...(await embedBatch(inputs.slice(i, i + BATCH_SIZE), onWait)));
  }
  return vectors;
}

async function embedBatch(
  batch: string[],
  onWait?: (ms: number) => void,
): Promise<number[][]> {
  const url = new URL("embeddings", ensureTrailingSlash(config.LLM_BASE_URL));
  let lastError: EmbeddingError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.EMBEDDING_MODEL,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal: requestSignal(),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new EmbeddingError(
          `Embeddings returned ${response.status}: ${body.slice(0, 300)}`,
          response.status,
        );
        if (!isRetryable(response.status)) throw error;
        lastError = error;
      } else {
        return readVectors(await response.json(), batch.length);
      }
    } catch (cause) {
      if (cause instanceof EmbeddingError) {
        if (cause.status === undefined || !isRetryable(cause.status)) throw cause;
        lastError = cause;
      } else {
        lastError = new EmbeddingError(`Embeddings request failed: ${(cause as Error).message}`);
      }
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      // A quota 429 waits out the minute; anything else is a blip.
      const quotaWait = lastError?.status === 429 ? QUOTA_BACKOFF_MS[attempt] : undefined;
      if (quotaWait !== undefined) onWait?.(quotaWait);
      await sleep(quotaWait ?? backoffMs(attempt));
    }
  }

  throw lastError ?? new EmbeddingError("Embeddings call failed");
}

/**
 * Read by array position, never by the `index` field.
 *
 * The provider omits `index` entirely when it is 0 — proto3 drops zero values —
 * so `data[0].index` is undefined. Sorting or keying on it silently misplaces
 * the first vector of every batch, which would be near-impossible to spot in a
 * similarity score.
 */
function readVectors(payload: unknown, expected: number): number[][] {
  const { data } = payload as EmbeddingResponse;
  if (!Array.isArray(data) || data.length !== expected) {
    throw new EmbeddingError(`Expected ${expected} embeddings, got ${data?.length ?? 0}`);
  }

  return data.map((item, position) => {
    const vector = item.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(
        `Embedding ${position} has ${vector?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
    return vector;
  });
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}
