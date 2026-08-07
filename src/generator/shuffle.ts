import type { RawQuestion } from "./gate.js";

/**
 * Fisher-Yates over the options, tracking where the correct answer lands.
 *
 * Models cluster the correct answer at index 0. Without this, a player learns
 * to tap the first button and the quiz stops being a quiz.
 */
export function shuffleOptions(
  question: RawQuestion,
  random: () => number = Math.random,
): RawQuestion {
  const options = [...question.options];
  const correct = options[question.correctIndex]!;

  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }

  return { ...question, options, correctIndex: options.indexOf(correct) };
}
