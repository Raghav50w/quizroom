import { describe, expect, it } from "vitest";
import { quizSchema, type Quiz } from "./quiz.js";
import { sampleQuiz } from "./sample-quiz.js";

/**
 * Each negative case is the valid sample mutated along exactly one axis, so a
 * failure points at a single rule.
 */
function broken(mutate: (quiz: Quiz) => void): unknown {
  const quiz = structuredClone(sampleQuiz);
  mutate(quiz);
  return quiz;
}

const firstQuestion = (quiz: Quiz) => quiz.questions[0]!;

describe("quizSchema", () => {
  it("accepts the sample quiz", () => {
    expect(quizSchema.safeParse(sampleQuiz).success).toBe(true);
  });

  it("rejects a question with 3 options", () => {
    const quiz = broken((q) => {
      firstQuestion(q).options.pop();
    });
    expect(quizSchema.safeParse(quiz).success).toBe(false);
  });

  it("rejects correctIndex out of range", () => {
    const quiz = broken((q) => {
      firstQuestion(q).correctIndex = 4;
    });
    expect(quizSchema.safeParse(quiz).success).toBe(false);
  });

  it("rejects duplicate options within a question", () => {
    const quiz = broken((q) => {
      const question = firstQuestion(q);
      question.options[2] = question.options[0];
    });
    const result = quizSchema.safeParse(quiz);
    expect(result.success).toBe(false);
    // Rejected for the intended reason, not by accident.
    expect(result.error?.issues[0]?.path).toEqual(["questions", 0, "options"]);
  });

  it("rejects duplicate options that differ only in case and whitespace", () => {
    const quiz = broken((q) => {
      const question = firstQuestion(q);
      question.options[2] = ` ${question.options[0].toUpperCase()} `;
    });
    expect(quizSchema.safeParse(quiz).success).toBe(false);
  });

  it("rejects a stem shorter than 10 characters", () => {
    const quiz = broken((q) => {
      firstQuestion(q).stem = "Short";
    });
    expect(quizSchema.safeParse(quiz).success).toBe(false);
  });

  it("rejects a missing schemaVersion", () => {
    const quiz = broken((q) => {
      delete (q as Partial<Quiz>).schemaVersion;
    });
    expect(quizSchema.safeParse(quiz).success).toBe(false);
  });

  it("rejects 21 questions", () => {
    const quiz = broken((q) => {
      const filler = firstQuestion(q);
      while (q.questions.length < 21) {
        q.questions.push({ ...structuredClone(filler), id: `filler-${q.questions.length}` });
      }
    });
    expect(quizSchema.safeParse(quiz).success).toBe(false);
  });
});
