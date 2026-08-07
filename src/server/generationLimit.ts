import { config } from "../config.js";

/**
 * One global daily counter. This is a fuse against our own retry loop
 * misbehaving, not a defence against abuse — there is no adversary here.
 *
 * In-memory on purpose: a restart resets it, which at this scale is fine and
 * costs nothing to reason about.
 */

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
