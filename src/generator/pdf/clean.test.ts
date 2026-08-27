import { describe, expect, it } from "vitest";
import { cleanPages } from "./clean.js";

/** Ten pages, each with a running header, a body line, and a numbered footer. */
function paper(bodyPerPage: string[]): string[] {
  return bodyPerPage.map(
    (body, index) => `Elangovan et al.: Power Electronics\n${body}\n${2436 + index} VOLUME 7`,
  );
}

/**
 * Distinct *words*, not a numbered template. "Body text for page 1..10" masks to
 * one identical string and would be stripped as chrome — correctly, which is the
 * one thing a fixture must not accidentally exercise.
 */
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
const tenBodies = WORDS.map((word) => `Prose about ${word} and its consequences.`);

describe("cleanPages", () => {
  it("strips a header repeated on every page", () => {
    const result = cleanPages(paper(tenBodies));
    expect(result).not.toContain("Elangovan");
    expect(result).toContain("Prose about echo and its consequences.");
  });

  it("strips numbered footers whose digits differ on every page", () => {
    // The whole reason normalisation masks digits: "2436 VOLUME 7" and
    // "2437 VOLUME 7" are different strings but the same piece of furniture.
    expect(cleanPages(paper(tenBodies))).not.toContain("VOLUME");
  });

  it("strips a footer that alternates between two forms", () => {
    // Recto/verso layout: each form reaches only half the pages, which is what
    // sank the 60% threshold this code was originally written with.
    const pages = WORDS.map((word, i) =>
      i % 2 === 0
        ? `Prose about ${word}.\n2436 VOLUME 7, 2026`
        : `Prose about ${word}.\nVOLUME 7, 2026 2437`,
    );
    expect(cleanPages(pages)).not.toContain("VOLUME");
    expect(cleanPages(pages)).toContain("Prose about hotel.");
  });

  it("keeps a line that appears on only two of ten pages", () => {
    const bodies = [...tenBodies];
    bodies[1] = "A recurring but genuine sentence.";
    bodies[6] = "A recurring but genuine sentence.";
    expect(cleanPages(paper(bodies))).toContain("A recurring but genuine sentence.");
  });

  it("keeps a repeated line when there are fewer than three pages", () => {
    // On two pages a shared line is 100% by definition; the rule would strip
    // half a short document.
    const pages = ["Shared heading\nFirst page body.", "Shared heading\nSecond page body."];
    expect(cleanPages(pages)).toContain("Shared heading");
  });

  it("keeps a long repeated paragraph — chrome is short", () => {
    const paragraph = `A licence notice long enough to be prose rather than page furniture, ${"x".repeat(90)}`;
    const pages = Array.from({ length: 10 }, (_, i) => `${paragraph}\nBody ${i}`);
    expect(cleanPages(pages)).toContain("A licence notice");
  });

  it("drops bare page numbers and their common dressings", () => {
    const pages = ["Alpha\n12", "Beta\n- 13 -", "Gamma\nPage 14", "Delta\n15 of 40"];
    const result = cleanPages(pages);
    expect(result.split("\n").filter((line) => /\d/.test(line))).toEqual([]);
    expect(result).toContain("Gamma");
  });

  it("rejoins a word broken across a line", () => {
    expect(cleanPages(["photo-\nsynthesis converts light."])).toContain("photosynthesis converts");
  });

  it("leaves a hyphen inside a line alone", () => {
    expect(cleanPages(["A well-known result.\nMore text."])).toContain("well-known");
  });

  it("leaves a compound broken before a capital alone", () => {
    // "State-of-the-\nArt" is a real hyphenated compound, not a syllable break.
    // Joining it would produce "State-of-theArt".
    expect(cleanPages(["State-of-the-\nArt design."])).toContain("State-of-the-");
  });

  it("collapses runs of blank lines", () => {
    expect(cleanPages(["First.\n\n\n\n\nSecond."])).toBe("First.\n\nSecond.");
  });
});
