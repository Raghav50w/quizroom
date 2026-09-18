import { config } from "../config.js";

/**
 * The single LLM call. One function, one endpoint, no adapters.
 *
 * One request timeout so a hung connection can't hold a generation slot
 * forever, and one retry on a rate limit, a server error, or a network
 * failure. A 400 is our bug — don't retry it.
 */

const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_WAIT_MS = 1_000;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callLLM(prompt: string): Promise<string> {
  const url = new URL("chat/completions", ensureTrailingSlash(config.LLM_BASE_URL));

  for (let attempt = 0; attempt < 2; attempt++) {
    const isLastAttempt = attempt === 1;
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.LLM_MODEL,
          temperature: 0.7,
          // One message. The rules, the source, and the user's request are a
          // single prompt — there is no system/user split anywhere here.
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      // Network failure or request timeout — worth one more attempt.
      if (isLastAttempt) throw new Error(`LLM request failed: ${(cause as Error).message}`);
      await sleep(RETRY_WAIT_MS);
      continue;
    }

    if (response.ok) {
      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("LLM returned an empty completion");
      }
      return content;
    }

    const body = await response.text().catch(() => "");
    const error = new Error(`LLM returned ${response.status}: ${body.slice(0, 300)}`);

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || isLastAttempt) throw error;
    await sleep(RETRY_WAIT_MS);
  }

  throw new Error("LLM call failed");
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}
