import type { RawQuestion } from "./gate.js";

/**
 * String-level near-duplicate removal: normalise, then Jaccard over token sets.
 *
 * No embeddings at any phase. Two questions on the same fact are almost always
 * lexically similar, and an embedding call here would add latency, cost, and a
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
