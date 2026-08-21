import { beforeEach, describe, expect, it } from "vitest";
import { _resetLimits, checkLimit } from "./rateLimit.js";

const HOUR = 60 * 60 * 1000;
const T0 = 1_000_000;

beforeEach(() => _resetLimits());

describe("checkLimit", () => {
  it("allows up to the limit, then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0).allowed).toBe(true);
    }
    expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0).allowed).toBe(false);
  });

  it("keeps callers separate, so one abuser can't block everyone", () => {
    // This is the entire point: the old global counter couldn't do this.
    for (let i = 0; i < 5; i++) checkLimit("save", "abuser", 5, HOUR, T0);
    expect(checkLimit("save", "abuser", 5, HOUR, T0).allowed).toBe(false);
    expect(checkLimit("save", "someone-else", 5, HOUR, T0).allowed).toBe(true);
  });

  it("keeps buckets separate, so saving doesn't consume generation budget", () => {
    for (let i = 0; i < 5; i++) checkLimit("generate", "1.1.1.1", 5, HOUR, T0);
    expect(checkLimit("generate", "1.1.1.1", 5, HOUR, T0).allowed).toBe(false);
    expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0).allowed).toBe(true);
  });

  it("lets the caller back in once the window has slid past", () => {
    for (let i = 0; i < 5; i++) checkLimit("save", "1.1.1.1", 5, HOUR, T0);
    expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0 + HOUR - 1).allowed).toBe(false);
    expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0 + HOUR + 1).allowed).toBe(true);
  });

  it("reports a sensible retry-after", () => {
    for (let i = 0; i < 5; i++) checkLimit("save", "1.1.1.1", 5, HOUR, T0);
    const blocked = checkLimit("save", "1.1.1.1", 5, HOUR, T0 + 10 * 60_000);
    // 10 minutes into the hour, so ~50 minutes left.
    expect(blocked.retryAfterSeconds).toBeGreaterThan(49 * 60);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(50 * 60);
  });

  it("is a sliding window, not a fixed bucket", () => {
    // Three hits early, two later: the early ones expire independently.
    for (let i = 0; i < 3; i++) checkLimit("save", "1.1.1.1", 5, HOUR, T0);
    for (let i = 0; i < 2; i++) checkLimit("save", "1.1.1.1", 5, HOUR, T0 + 30 * 60_000);
    expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0 + 31 * 60_000).allowed).toBe(false);
    // Past the first three expiring, there is room again.
    expect(checkLimit("save", "1.1.1.1", 5, HOUR, T0 + HOUR + 1_000).allowed).toBe(true);
  });
});
