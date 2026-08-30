import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError, callLLM } from "./llm.js";

// Fake config, so the test needs no .env and never touches a real key.
vi.mock("../config.js", () => ({
  config: {
    LLM_BASE_URL: "https://example.invalid/v1/",
    LLM_API_KEY: "test-key",
    LLM_MODEL: "test-model",
    GENERATION_ENABLED: true,
    DAILY_GENERATION_LIMIT: 100,
  },
}));

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const fail = (status: number) => new Response("upstream said no", { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Full jitter is random() * base * 2^n, so a zero source makes every
  // backoff zero — the retry logic is asserted without the wall-clock wait.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("callLLM", () => {
  it("returns the completion on the first success", async () => {
    fetchMock.mockResolvedValue(ok("hello"));
    await expect(callLLM("prompt")).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and succeeds", async () => {
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok("hello"));
    await expect(callLLM("prompt")).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 500 and succeeds", async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok("hello"));
    await expect(callLLM("prompt")).resolves.toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 — a bad request is our bug, not weather", async () => {
    fetchMock.mockResolvedValue(fail(400));
    await expect(callLLM("prompt")).rejects.toThrow(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure, then gives up with bounded attempts", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(callLLM("prompt")).rejects.toThrow(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops once retries would run past the job deadline", async () => {
    fetchMock.mockResolvedValue(fail(429));
    await expect(
      callLLM("prompt", { deadlineAt: Date.now() - 1 }),
    ).rejects.toThrow(/deadline/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on an empty completion without retrying", async () => {
    fetchMock.mockResolvedValue(ok("   "));
    await expect(callLLM("prompt")).rejects.toThrow(/empty/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the model and auth header the provider expects", async () => {
    fetchMock.mockResolvedValue(ok("hello"));
    await callLLM("prompt");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://example.invalid/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string).model).toBe("test-model");
  });

  it("aborts when the caller's signal fires", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    await expect(
      callLLM("prompt", { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
