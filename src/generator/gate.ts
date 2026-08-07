import { z } from "zod";

/**
 * The validation gate. Bad questions are DROPPED, never thrown — one malformed
 * question must not cost the user the other nine.
 *
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

export const rawResponseSchema = z.object({
  questions: z.array(rawQuestionSchema),
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

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Returns the reason this question fails, or null if it passes.
 * Order matters only for which reason gets reported first.
 */
export function checkQuestion(question: unknown): string | null {
  const parsed = rawQuestionSchema.safeParse(question);
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "failed schema";
  }

  const { stem, options, correctIndex } = parsed.data;
  const normalisedOptions = options.map(normalise);

  if (new Set(normalisedOptions).size !== 4) return "duplicate options";

  if (normalisedOptions.some((option) => BANNED_PHRASES.some((banned) => option.includes(banned)))) {
    return "banned option phrase";
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
    const reason = checkQuestion(question);
    if (reason === null) {
      kept.push(rawQuestionSchema.parse(question));
    } else {
      const stem = typeof (question as RawQuestion)?.stem === "string"
        ? (question as RawQuestion).stem
        : "(unparseable)";
      dropped.push({ reason, stem });
    }
  }

  return { kept, dropped };
}
