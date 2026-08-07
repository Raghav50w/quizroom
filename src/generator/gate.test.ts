import { describe, expect, it } from "vitest";
import { runGate } from "./gate.js";
import { extractJson } from "./parse.js";

/**
 * The gate must DROP bad questions, never throw. A single malformed question in
 * a batch of twelve must not cost the user the other eleven.
 */

const good = {
  stem: "Which planet orbits closest to the Sun?",
  options: ["Venus", "Mercury", "Mars", "Earth"],
  correctIndex: 1,
};

const bad = {
  threeOptions: {
    stem: "Which planet orbits closest to the Sun?",
    options: ["Venus", "Mercury", "Mars"],
    correctIndex: 1,
  },
  indexOutOfRange: { ...good, correctIndex: 4 },
  duplicateOptions: {
    stem: "Which planet orbits closest to the Sun?",
    options: ["Venus", "Mercury", "venus ", "Earth"],
    correctIndex: 1,
  },
  identicalOptions: {
    stem: "Which planet orbits closest to the Sun?",
    options: ["Venus", "Venus", "Venus", "Venus"],
    correctIndex: 0,
  },
  allOfTheAbove: {
    stem: "Which of these are planets in our Solar System?",
    options: ["Venus", "Mercury", "Mars", "All of the above"],
    correctIndex: 3,
  },
  leakedAnswer: {
    stem: "Is Mercury the planet closest to the Sun in our Solar System?",
    options: ["Venus", "Mercury", "Mars", "Earth"],
    correctIndex: 1,
  },
  lengthRatio: {
    stem: "Which planet orbits closest to the Sun?",
    options: [
      "Mercury, the smallest planet and the one nearest to the Sun",
      "Venus",
      "Mars",
      "Earth",
    ],
    correctIndex: 0,
  },
  shortStem: { ...good, stem: "Sun?" },
  notAnObject: "I'm sorry, I can't help with that request.",
};

describe("runGate", () => {
  it("keeps a valid question", () => {
    const result = runGate([good]);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it.each(Object.entries(bad))("drops: %s", (_name, question) => {
    const result = runGate([question]);
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });

  it("drops the bad ones without losing the good ones", () => {
    const result = runGate([good, bad.allOfTheAbove, good, bad.notAnObject, bad.shortStem]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(3);
  });

  it("reports the reason each question was dropped", () => {
    expect(runGate([bad.duplicateOptions]).dropped[0]?.reason).toBe("duplicate options");
    expect(runGate([bad.allOfTheAbove]).dropped[0]?.reason).toBe("banned option phrase");
    expect(runGate([bad.leakedAnswer]).dropped[0]?.reason).toBe("stem leaks the answer");
    expect(runGate([bad.lengthRatio]).dropped[0]?.reason).toBe("option length ratio");
  });
});

describe("extractJson", () => {
  it("reads bare JSON", () => {
    expect(extractJson('{"questions":[]}')).toEqual({ questions: [] });
  });

  it("reads JSON inside a markdown fence", () => {
    expect(extractJson('```json\n{"questions":[]}\n```')).toEqual({ questions: [] });
  });

  it("reads JSON preceded by prose", () => {
    expect(extractJson('Sure! Here you go:\n{"questions":[]}')).toEqual({ questions: [] });
  });

  it("throws on a plaintext refusal", () => {
    expect(() => extractJson("I'm sorry, I can't help with that.")).toThrow();
  });
});
