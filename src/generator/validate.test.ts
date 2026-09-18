import { describe, expect, it } from "vitest";
import { dedupe, extractJson, runGate, shuffleOptions, type RawQuestion } from "./validate.js";

const good: RawQuestion = {
  stem: "Which planet orbits closest to the Sun?",
  options: ["Mercury", "Venus", "Mars", "Earth"],
  correctIndex: 0,
};

const allOfTheAbove = {
  stem: "Which of these are planets in our Solar System?",
  options: ["Venus", "Mercury", "Mars", "All of the above"],
  correctIndex: 3,
};

const shortStem = { ...good, stem: "Sun?" };

const notAnObject = "I'm sorry, I can't help with that request.";

describe("validate", () => {
  it("drops the bad questions without losing the good ones", () => {
    // A single malformed question in a batch must not cost the user the rest.
    const result = runGate([good, allOfTheAbove, good, notAnObject, shortStem]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(3);
  });

  it("reads JSON inside a markdown fence", () => {
    expect(extractJson('```json\n{"questions":[]}\n```')).toEqual({ questions: [] });
  });

  it("drops a near-duplicate stem and keeps the first", () => {
    const result = dedupe([
      good,
      { ...good, stem: "Which planet orbits the closest to the Sun?" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.stem).toBe(good.stem);
  });

  it("keeps correctIndex pointing at the same answer after a shuffle", () => {
    for (let i = 0; i < 20; i++) {
      const result = shuffleOptions(good);
      expect(result.options[result.correctIndex]).toBe("Mercury");
      expect([...result.options].sort()).toEqual([...good.options].sort());
    }
  });
});
