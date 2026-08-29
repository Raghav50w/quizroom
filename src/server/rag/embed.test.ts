import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, EmbeddingError, embed } from "./embed.js";

// Fake config, so the test needs no .env and never touches a real key.
vi.mock("../../config.js", () => ({
  config: {
    LLM_BASE_URL: "https://example.invalid/v1/",
    LLM_API_KEY: "test-key",
    EMBEDDING_MODEL: "test-embed-model",
  },
}));

/** A vector whose every element is `fill`, so batches are told apart by value. */
const vec = (fill: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);

/**
 * Mirrors the real provider: `index` is OMITTED on the first item, because
 * proto3 drops zero values. Keying on it would misplace the first vector.
 */
const ok = (fills: number[]) =>
  new Response(
    JSON.stringify({
      data: fills.map((fill, i) => (i === 0 ? { embedding: vec(fill) } : { index: i, embedding: vec(fill) })),
    }),
    { status: 200 },
  );

const fail = (status: number) => new Response("upstream said no", { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("embed", () => {
  it("returns one vector per input, in input order", async () => {
    fetchMock.mockResolvedValueOnce(ok([0.1, 0.2, 0.3]));
    const vectors = await embed(["a", "b", "c"]);
    expect(vectors).toHaveLength(3);
    expect(vectors.map((v) => v[0])).toEqual([0.1, 0.2, 0.3]);
  });

  it("keeps the first vector in place despite a missing index field", async () => {
    // The bug this guards: the provider omits `index` when it is 0, so any
    // code sorting or keying by it silently misplaces the first embedding of
    // every batch — invisible in a similarity score.
    fetchMock.mockResolvedValueOnce(ok([0.9, 0.1, 0.2]));
    const [first] = await embed(["most important", "b", "c"]);
    expect(first![0]).toBe(0.9);
  });

  it("pins the dimension in the request", async () => {
    fetchMock.mockResolvedValueOnce(ok([0.1]));
    await embed(["a"]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    // Omitting this returns 3072, which the schema column would reject.
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(body.model).toBe("test-embed-model");
  });

  it("splits a large input into batches and concatenates in order", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(Array.from({ length: 16 }, () => 0.5)))
      .mockResolvedValueOnce(ok([0.7, 0.7]));
    const vectors = await embed(Array.from({ length: 18 }, (_, i) => `chunk ${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(18);
    expect(vectors[15]![0]).toBe(0.5);
    expect(vectors[16]![0]).toBe(0.7);
  });

  it("rejects a vector of the wrong length rather than storing it", async () => {
    // Storing a 3072-vector fails at the database with a far less obvious error.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 }),
    );
    await expect(embed(["a"])).rejects.toThrow(/3 dimensions, expected 768/);
  });

  it("rejects a response with the wrong number of vectors", async () => {
    fetchMock.mockResolvedValueOnce(ok([0.1, 0.2]));
    await expect(embed(["a", "b", "c"])).rejects.toThrow(/Expected 3 embeddings, got 2/);
  });

  it("retries a 500 and succeeds", async () => {
    fetchMock.mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok([0.4]));
    expect((await embed(["a"]))[0]![0]).toBe(0.4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 — a bad request is our bug", async () => {
    fetchMock.mockResolvedValue(fail(400));
    await expect(embed(["a"])).rejects.toBeInstanceOf(EmbeddingError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits on the minute scale for a quota 429, not the millisecond scale", async () => {
    // A jittered backoff tops out near 8s and can never outlast a 60s window,
    // so every attempt would fail identically. Asserted through the callback
    // rather than the clock, so the test stays fast.
    vi.useFakeTimers();
    const waits: number[] = [];
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok([0.6]));
    const pending = embed(["a"], (ms) => waits.push(ms));
    await vi.runAllTimersAsync();
    await pending;
    expect(waits).toEqual([20_000]);
    vi.useRealTimers();
  });
});
