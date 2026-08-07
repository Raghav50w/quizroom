import type { Question as QuestionType } from "../../shared/quiz.js";

interface QuestionProps {
  question: QuestionType;
  index: number;
  total: number;
  score: number;
  msLeft: number;
  durationMs: number;
  /** Set once this player has locked an answer in. */
  chosenIndex: number | undefined;
  onAnswer: (optionIndex: number) => void;
}

export function Question({
  question,
  index,
  total,
  score,
  msLeft,
  durationMs,
  chosenIndex,
  onAnswer,
}: QuestionProps) {
  const secondsLeft = Math.ceil(msLeft / 1000);
  const fraction = durationMs === 0 ? 0 : msLeft / durationMs;

  return (
    <div className="flex h-full flex-col p-4 sm:p-8">
      <div className="flex items-center justify-between text-sm font-medium text-slate-500">
        <span>
          {index + 1} / {total}
        </span>
        <span
          className={`text-2xl font-bold tabular-nums ${
            secondsLeft <= 5 ? "text-rose-600" : "text-slate-900"
          }`}
        >
          {secondsLeft}
        </span>
        <span>{score} pts</span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full transition-[width] duration-100 ease-linear ${
            secondsLeft <= 5 ? "bg-rose-500" : "bg-indigo-600"
          }`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>

      <h2 className="flex flex-1 items-center justify-center py-4 text-center text-xl font-semibold text-balance text-slate-900 sm:text-3xl lg:text-4xl">
        {question.stem}
      </h2>

      {/* Plain text, full-width tap targets, no a)/b) letters and no shapes.
          Two columns once there's width for them; still one screen, no scroll. */}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {question.options.map((option, optionIndex) => {
          const chosen = chosenIndex === optionIndex;
          return (
            <button
              key={option}
              type="button"
              disabled={chosenIndex !== undefined}
              onClick={() => onAnswer(optionIndex)}
              className={`w-full rounded-2xl border-2 px-4 py-5 text-lg font-medium transition active:scale-[0.99] sm:py-8 sm:text-xl ${
                chosen
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-800 disabled:opacity-40"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>

      <p className="h-6 pt-2 text-center text-sm text-slate-500">
        {chosenIndex !== undefined ? "Locked in" : " "}
      </p>
    </div>
  );
}
