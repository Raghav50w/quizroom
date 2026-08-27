import { describe, expect, it } from "vitest";
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkText } from "./chunk.js";

/** Distinct characters throughout, so a slice comparison can't pass by accident. */
const long = Array.from({ length: 10_000 }, (_, i) => String.fromCharCode(33 + (i % 90))).join("");

describe("chunkText", () => {
  it("overlaps neighbours by exactly the overlap", () => {
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.text.slice(0, CHUNK_OVERLAP)).toBe(
        chunks[i - 1]!.text.slice(-CHUNK_OVERLAP),
      );
    }
  });

  it("numbers ordinals 0, 1, 2 with no gaps", () => {
    expect(chunkText(long).map((chunk) => chunk.ordinal)).toEqual(
      chunkText(long).map((_, index) => index),
    );
  });

  it("returns one chunk for text shorter than one window", () => {
    const chunks = chunkText("Short document.");
    expect(chunks).toEqual([{ ordinal: 0, text: "Short document." }]);
  });

  it("returns one chunk for text exactly one window long", () => {
    expect(chunkText("y".repeat(CHUNK_SIZE))).toHaveLength(1);
  });

  it("drops a trailing window already contained in its predecessor", () => {
    // stride is 2,600, so a 2,700-char input would otherwise emit a second
    // chunk of 100 chars that the first chunk already covers in full.
    const chunks = chunkText("z".repeat(CHUNK_SIZE - CHUNK_OVERLAP + 100));
    expect(chunks).toHaveLength(1);
  });

  it("covers the whole document across chunks", () => {
    const chunks = chunkText(long);
    expect(chunks.at(-1)!.text.endsWith(long.slice(-50))).toBe(true);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });
});
