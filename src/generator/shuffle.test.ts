import { describe, expect, it } from "vitest";
import { shuffleOptions } from "./shuffle.js";
import { dedupe } from "./dedupe.js";
import type { RawQuestion } from "./gate.js";

const question: RawQuestion = {
  stem: "Which planet orbits closest to the Sun?",
  options: ["Mercury", "Venus", "Mars", "Earth"],
  correctIndex: 0,
};

describe("shuffleOptions", () => {
  it("reorders the options", () => {
    // Deterministic source, so this asserts our code, not the RNG.
    // Always-0 picks j=0 at every step, which is a real reordering;
    // always-0.99 picks j=i, whose swaps are all identities.
    const random = sequence([0]);
    const result = shuffleOptions(question, random);
    expect(result.options).not.toEqual(question.options);
  });

  it("keeps correctIndex pointing at the same answer", () => {
    for (let seed = 0; seed < 50; seed++) {
      const result = shuffleOptions(question);
      expect(result.options[result.correctIndex]).toBe("Mercury");
      expect([...result.options].sort()).toEqual([...question.options].sort());
    }
  });
});

describe("dedupe", () => {
  it("drops a near-duplicate stem and keeps the first", () => {
    const result = dedupe([
      question,
      { ...question, stem: "Which planet orbits the closest to the Sun?" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.stem).toBe(question.stem);
  });

  it("keeps genuinely different questions", () => {
    const result = dedupe([
      question,
      { ...question, stem: "What are the rings of Saturn mostly made of?" },
    ]);
    expect(result).toHaveLength(2);
  });
});

function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}
