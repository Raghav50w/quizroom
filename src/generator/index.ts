import { nanoid } from "nanoid";
import { quizSchema, type Quiz } from "../shared/quiz.js";
import { dedupe } from "./dedupe.js";
import { runGate, rawResponseSchema, type RawQuestion } from "./gate.js";
import { callLLM } from "./llm.js";
import { extractJson } from "./parse.js";
import { buildPrompt } from "./prompt.js";
import { shuffleOptions } from "./shuffle.js";

/**
 * Topic or pasted text -> validated Quiz JSON.
 *
 * Imports nothing from src/server or src/client — the whole point of the split
 * is that Track B (PDF/RAG) can later feed this same pipeline, and that this
 * folder could be lifted into its own repo.
 */

const TOTAL_JOB_TIMEOUT_MS = 120_000;
const OVERSHOOT = 2;

export interface GenerateOptions {
  /** Pasted notes, or a topic name. One field, one prompt path. */
  source: string;
  count: number;
  title?: string;
  sourceMode?: Quiz["sourceMode"];
  /** What the user typed in the focus box. Appended as the prompt's last line. */
  prompt?: string;
  /** Progress and diagnostics. Never stdout — the CLI pipes the payload there. */
  log?: (message: string) => void;
}

export interface GenerateResult {
  quiz: Quiz;
  /** Set when the gate left us short of `count`. The caller reports it. */
  shortfall?: { requested: number; delivered: number };
}

export async function generateQuiz(options: GenerateOptions): Promise<GenerateResult> {
  const { source, count, log = () => {} } = options;
  const deadlineAt = Date.now() + TOTAL_JOB_TIMEOUT_MS;
  const asked = Math.min(count + OVERSHOOT, 20);

  const raw = await requestQuestions(source, asked, deadlineAt, log, options.prompt);

  const { kept, dropped } = runGate(raw);
  for (const drop of dropped) {
    log(`dropped (${drop.reason}): ${drop.stem.slice(0, 60)}`);
  }

  const unique = dedupe(kept);
  if (unique.length < kept.length) {
    log(`dropped ${kept.length - unique.length} near-duplicate question(s)`);
  }

  const selected = unique.slice(0, count);
  if (selected.length === 0) {
    throw new Error("No questions survived validation");
  }

  const quiz = quizSchema.parse({
    schemaVersion: 1,
    id: nanoid(10),
    title: options.title?.trim() || deriveTitle(source),
    createdAt: new Date().toISOString(),
    sourceMode: options.sourceMode ?? "text",
    questions: selected.map(toQuestion),
  });

  return {
    quiz,
    ...(selected.length < count
      ? { shortfall: { requested: count, delivered: selected.length } }
      : {}),
  };
}

/** One call, then one retry — malformed JSON is rare, so a loop isn't warranted. */
async function requestQuestions(
  source: string,
  asked: number,
  deadlineAt: number,
  log: (message: string) => void,
  userPrompt?: string,
): Promise<unknown[]> {
  const prompt = buildPrompt(source, asked, userPrompt);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await callLLM(prompt, { deadlineAt });
    try {
      return rawResponseSchema.parse(extractJson(completion)).questions;
    } catch (cause) {
      lastError = cause as Error;
      log(`unusable model response (attempt ${attempt + 1}): ${lastError.message}`);
    }
  }

  throw new Error(`Model did not return usable JSON: ${lastError?.message ?? "unknown"}`);
}

function toQuestion(raw: RawQuestion) {
  const shuffled = shuffleOptions(raw);
  return {
    id: nanoid(8),
    stem: shuffled.stem,
    options: shuffled.options,
    correctIndex: shuffled.correctIndex,
    origin: "ai" as const,
  };
}

function deriveTitle(source: string): string {
  const firstLine = source.trim().split("\n")[0]!.trim();
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57)}...`;
}
