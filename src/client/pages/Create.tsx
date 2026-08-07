import { useEffect, useState } from "react";
import type { Question, Quiz } from "../../shared/quiz.js";
import { ApiError, generateQuiz, ping } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { Review } from "./Review.js";

const COUNTS = [5, 10, 15, 20] as const;
const MAX_SOURCE_CHARS = 15_000;

type Stage =
  | { name: "input" }
  | { name: "generating" }
  | { name: "review"; questions: Question[]; title: string; sourceMode: Quiz["sourceMode"] };

/**
 * Create is desktop-first on purpose — hosts create on a laptop and play on a
 * phone. Everything here is React state; nothing is written until Review posts.
 */
export function Create() {
  const [stage, setStage] = useState<Stage>({ name: "input" });
  const [source, setSource] = useState("");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Someone can spend 16 minutes pasting notes; the free box sleeps at 15.
  // The cold start on page load is absorbed by the load itself — this covers
  // the case that actually bites.
  useEffect(() => {
    const timer = setInterval(() => void ping(), 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  async function onGenerate() {
    setError(null);
    setNotice(null);
    setStage({ name: "generating" });
    try {
      const { quiz, shortfall } = await generateQuiz(source.trim(), count);
      if (shortfall) {
        setNotice(
          `${shortfall.delivered} of ${shortfall.requested} questions passed validation. You can add more by hand.`,
        );
      }
      setStage({
        name: "review",
        questions: quiz.questions,
        title: quiz.title,
        sourceMode: "text",
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not reach the server.");
      setStage({ name: "input" });
    }
  }

  function startManual() {
    setStage({ name: "review", questions: [], title: "", sourceMode: "manual" });
  }

  if (stage.name === "review") {
    return (
      <Review
        initialQuestions={stage.questions}
        initialTitle={stage.title}
        sourceMode={stage.sourceMode}
        notice={notice}
        onBack={() => setStage({ name: "input" })}
      />
    );
  }

  const busy = stage.name === "generating";

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        &larr; Back
      </button>

      <h1 className="mt-4 text-3xl font-bold text-slate-900">Make a quiz</h1>

      <label htmlFor="source" className="mt-8 block text-sm font-medium text-slate-700">
        Paste your notes, or describe a topic
      </label>
      <textarea
        id="source"
        value={source}
        disabled={busy}
        onChange={(event) => setSource(event.target.value.slice(0, MAX_SOURCE_CHARS))}
        rows={10}
        placeholder="e.g. the French Revolution&#10;&#10;...or paste a few pages of lecture notes."
        className="mt-2 w-full resize-y rounded-2xl border-2 border-slate-200 p-4 text-base text-slate-800 outline-none focus:border-indigo-500 disabled:bg-slate-50"
      />
      <p className="mt-1 text-right text-xs text-slate-400">
        {source.length.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()}
      </p>

      <p className="mt-6 text-sm font-medium text-slate-700">How many questions?</p>
      <div className="mt-2 flex gap-2">
        {COUNTS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={() => setCount(value)}
            className={`w-20 rounded-xl border-2 py-3 text-lg font-semibold transition ${
              value === count
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
      )}

      <button
        type="button"
        disabled={busy || source.trim().length === 0}
        onClick={() => void onGenerate()}
        className="mt-8 w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40"
      >
        {busy ? "Writing questions…" : "Generate"}
      </button>
      {busy && (
        <p className="mt-3 text-center text-sm text-slate-500">
          This takes 5–15 seconds. Keep the tab open.
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={startManual}
        className="mt-4 w-full rounded-2xl border-2 border-slate-200 py-4 text-base font-medium text-slate-600 transition hover:border-slate-300 disabled:opacity-40"
      >
        Write questions myself
      </button>
    </div>
  );
}
