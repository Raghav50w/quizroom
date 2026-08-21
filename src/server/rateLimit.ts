import type { Request } from "express";

/**
 * A small in-memory, per-caller sliding window.
 *
 * The point is not to stop a determined attacker — it is to stop one script,
 * or one bored person, from filling the database or burning the day's LLM
 * allowance for everybody else. The existing global counter can't do that
 * because it can't tell one visitor from a hundred.
 *
 * In-memory on purpose: a restart clears it, which at this scale is fine and
 * costs nothing to reason about.
 */

interface Window {
  hits: number[];
}

const buckets = new Map<string, Map<string, Window>>();

/** Render puts one proxy in front, so the real address is in X-Forwarded-For. */
export function callerKey(req: Request): string {
  return req.ip ?? "unknown";
}

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

export function checkLimit(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): LimitResult {
  let windows = buckets.get(bucket);
  if (!windows) {
    windows = new Map();
    buckets.set(bucket, windows);
  }

  const window = windows.get(key) ?? { hits: [] };
  const cutoff = now - windowMs;
  window.hits = window.hits.filter((at) => at > cutoff);

  if (window.hits.length >= limit) {
    windows.set(key, window);
    const oldest = window.hits[0]!;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  window.hits.push(now);
  windows.set(key, window);

  // Without this the map grows by one entry per address, forever.
  if (windows.size > 5_000) {
    for (const [otherKey, otherWindow] of windows) {
      if (otherWindow.hits.every((at) => at <= cutoff)) windows.delete(otherKey);
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test seam. */
export function _resetLimits(): void {
  buckets.clear();
}
