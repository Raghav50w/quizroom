import type { Request } from "express";
import { config } from "../config.js";

/**
 * Two in-memory limits. Both reset on restart, which at this scale is fine
 * and costs nothing to reason about.
 *
 *   1. Per-caller sliding window — stops one script, or one bored person,
 *      from filling the database or burning the day's LLM allowance for
 *      everybody else.
 *   2. One global daily counter — a fuse against our own retry loop
 *      misbehaving, not a defence against abuse.
 */

// ---------------------------------------------------------------------------
// 1. Per-caller sliding window
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2. Daily generation counter
// ---------------------------------------------------------------------------

let day = today();
let used = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface LimitState {
  allowed: boolean;
  reason?: "disabled" | "daily_limit";
  used: number;
  limit: number;
}

export function checkGenerationAllowed(): LimitState {
  if (day !== today()) {
    day = today();
    used = 0;
  }

  if (!config.GENERATION_ENABLED) {
    return { allowed: false, reason: "disabled", used, limit: config.DAILY_GENERATION_LIMIT };
  }
  if (used >= config.DAILY_GENERATION_LIMIT) {
    return { allowed: false, reason: "daily_limit", used, limit: config.DAILY_GENERATION_LIMIT };
  }
  return { allowed: true, used, limit: config.DAILY_GENERATION_LIMIT };
}

/** Counted before the call, so a hung request still consumes its slot. */
export function recordGeneration(): void {
  used += 1;
}
