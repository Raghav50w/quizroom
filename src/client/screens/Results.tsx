import type { Question as QuestionType } from "../../shared/quiz.js";

interface ResultsProps {
  question: QuestionType;
  chosenIndex: number | undefined;
  score: number;
  index: number;
  total: number;
}

/** Between questions: the correct answer, whether you got it, and your score. */
export function Results({ question, chosenIndex, score, index, total }: ResultsProps) {
  const answered = chosenIndex !== undefined;
  const correct = chosenIndex === question.correctIndex;

  return (
    <div className="flex h-full flex-col justify-center gap-6 p-6 text-center">
      <div>
        <p className="text-sm font-medium text-slate-400">
          {index + 1} / {total}
        </p>
        <p
          className={`mt-2 text-3xl font-bold ${
            correct ? "text-emerald-600" : answered ? "text-rose-600" : "text-slate-500"
          }`}
        >
          {correct ? "Correct" : answered ? "Not quite" : "Time's up"}
        </p>
      </div>

      <div className="rounded-2xl bg-slate-100 p-5">
        <p className="text-sm text-slate-500">{question.stem}</p>
        <p className="mt-3 text-xl font-semibold text-slate-900 sm:text-3xl">
          {question.options[question.correctIndex]}
        </p>
      </div>

      <p className="text-lg font-medium text-slate-600">
        {score} {score === 1 ? "point" : "points"}
      </p>
    </div>
  );
}
