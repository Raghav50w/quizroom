import { describe, expect, it } from "vitest";
import { evenSample, sortByOrdinal } from "./sample.js";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("evenSample", () => {
  it("picks 4 spread across 50, not the first 4", () => {
    const picked = evenSample(range(50), 4);
    expect(picked).toHaveLength(4);
    // Roughly a twelfth, three-eighths, five-eighths, eleven-twelfths in.
    expect(picked).toEqual([6, 18, 31, 43]);
  });

  it("reaches into the last quarter of a long document", () => {
    // The bug this guards: `i * step` always picks index 0 and stops well short
    // of the end, so the tail of every document goes unsampled.
    const picked = evenSample(range(100), 4);
    expect(picked.at(-1)!).toBeGreaterThan(75);
    expect(picked[0]!).toBeGreaterThan(0);
  });

  it("returns everything when there are fewer items than asked for", () => {
    expect(evenSample(range(3), 4)).toEqual([0, 1, 2]);
    expect(evenSample([], 4)).toEqual([]);
  });

  it("returns everything when the counts match exactly", () => {
    expect(evenSample(range(4), 4)).toEqual([0, 1, 2, 3]);
  });

  it("keeps input order and never repeats an item", () => {
    const picked = evenSample(range(50), 4);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("does not mutate the input", () => {
    const items = range(10);
    evenSample(items, 4);
    expect(items).toEqual(range(10));
  });
});

describe("sortByOrdinal", () => {
  it("restores document order from similarity order", () => {
    // What cosine search actually hands back: most similar first.
    const bySimilarity = [{ ordinal: 31 }, { ordinal: 6 }, { ordinal: 43 }, { ordinal: 18 }];
    expect(sortByOrdinal(bySimilarity).map((c) => c.ordinal)).toEqual([6, 18, 31, 43]);
  });

  it("does not mutate the input", () => {
    const rows = [{ ordinal: 2 }, { ordinal: 0 }];
    sortByOrdinal(rows);
    expect(rows.map((r) => r.ordinal)).toEqual([2, 0]);
  });
});
