import { z } from "zod";

/**
 * Everything that happens to the model's output before it becomes a quiz:
 *
 *   1. extractJson    pull JSON out of whatever text came back
 *   2. runGate        drop questions that fail the rules
 *   3. dedupe         drop near-duplicate stems
 *   4. shuffleOptions move the correct answer to a random position
 *
 * Bad questions are DROPPED, never thrown — one malformed question must not
 * cost the user the other nine.
 */

// ---------------------------------------------------------------------------
// 1. Extract JSON
// ---------------------------------------------------------------------------

/**
 * Models wrap JSON in markdown fences, prepend "Here's your quiz:", or refuse
 * in plain prose. The first two are recoverable here; the third has no JSON to
 * find and surfaces as a parse failure, which the caller retries once.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // Shape 1: the whole response is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try the next shape.
  }

  // Shape 2: JSON inside a ```json fence.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Try the next shape.
    }
  }

  // Shape 3: prose before and/or after the outermost braces.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // Nothing left to try.
    }
  }

  throw new Error("No JSON found in model response");
}

// ---------------------------------------------------------------------------
// 2. Gate
// ---------------------------------------------------------------------------

/**
 * We ask for count + 2 and keep the first `count` that survive. A decent model
 * overshoots, so this lands on the requested number almost always, with no
 * retry loop and no second "top-up" prompting mode.
 */

/** What the model is asked to emit, before ids and shuffling. */
export const rawQuestionSchema = z.object({
  stem: z.string().min(10).max(200),
  options: z.array(z.string().min(1).max(80)).length(4),
  correctIndex: z.number().int().min(0).max(3),
});

/**
 * The envelope only. Each question is checked one at a time by `runGate`, so a
 * single over-long option drops that question rather than the whole batch.
 */
export const rawResponseSchema = z.object({
  questions: z.array(z.unknown()),
});

export type RawQuestion = z.infer<typeof rawQuestionSchema>;

export interface GateResult {
  kept: RawQuestion[];
  dropped: Array<{ reason: string; stem: string }>;
}

/** Longest option more than this multiple of the shortest is the real LLM tell. */
const MAX_LENGTH_RATIO = 2.5;

const BANNED_PHRASES = [
  "all of the above",
  "none of the above",
  "both a and b",
  "both of the above",
  "any of the above",
];

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Returns the reason this question fails, or null if it passes.
 * Order matters only for which reason gets reported first.
 */
export function checkQuestion(question: RawQuestion): string | null {
  const { stem, options, correctIndex } = question;
  const normalisedOptions = options.map(normalise);

  if (new Set(normalisedOptions).size !== 4) return "duplicate options";

  for (const option of normalisedOptions) {
    for (const banned of BANNED_PHRASES) {
      if (option.includes(banned)) return "banned option phrase";
    }
  }

  // Answer leak: the stem already contains the correct option's wording.
  const correct = normalisedOptions[correctIndex]!;
  if (correct.length >= 4 && normalise(stem).includes(correct)) {
    return "stem leaks the answer";
  }

  const lengths = options.map((option) => option.length);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  if (shortest > 0 && longest / shortest > MAX_LENGTH_RATIO) {
    return "option length ratio";
  }

  return null;
}

export function runGate(questions: unknown[]): GateResult {
  const kept: RawQuestion[] = [];
  const dropped: GateResult["dropped"] = [];

  for (const question of questions) {
    const parsed = rawQuestionSchema.safeParse(question);

    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? "failed schema";
      const stem = (question as { stem?: unknown })?.stem;
      dropped.push({ reason, stem: typeof stem === "string" ? stem : "(unparseable)" });
      continue;
    }

    const reason = checkQuestion(parsed.data);
    if (reason === null) {
      kept.push(parsed.data);
    } else {
      dropped.push({ reason, stem: parsed.data.stem });
    }
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// 3. Dedupe
// ---------------------------------------------------------------------------

/**
 * String-level near-duplicate removal: normalise, then Jaccard over token sets.
 *
 * No embeddings. Two questions on the same fact are almost always lexically
 * similar, and an embedding call here would add latency, cost, and a
 * dependency to solve a problem the token overlap already catches.
 */

const JACCARD_THRESHOLD = 0.8;

function tokenise(stem: string): Set<string> {
  return new Set(
    stem
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 0),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Keeps the first of each near-duplicate group, preserving order. */
export function dedupe(questions: RawQuestion[]): RawQuestion[] {
  const kept: RawQuestion[] = [];
  const keptTokens: Array<Set<string>> = [];

  for (const question of questions) {
    const tokens = tokenise(question.stem);
    const isDuplicate = keptTokens.some((seen) => jaccard(tokens, seen) >= JACCARD_THRESHOLD);
    if (!isDuplicate) {
      kept.push(question);
      keptTokens.push(tokens);
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// 4. Shuffle
// ---------------------------------------------------------------------------

/**
 * Fisher-Yates over the options, tracking where the correct answer lands.
 *
 * Models cluster the correct answer at index 0. Without this, a player learns
 * to tap the first button and the quiz stops being a quiz.
 */
export function shuffleOptions(question: RawQuestion): RawQuestion {
  const options = [...question.options];
  const correct = options[question.correctIndex]!;

  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }

  return { ...question, options, correctIndex: options.indexOf(correct) };
}
