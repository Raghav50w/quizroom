import { useState } from "react";
import { listMyQuizzes } from "../lib/myQuizzes.js";
import { navigate } from "../lib/router.js";

/**
 * Big join box, create below. Create stays visible because a recruiter arrives
 * with no room code.
 */
export function Landing() {
  const mine = listMyQuizzes();
  const [code, setCode] = useState("");

  // People type "08241", " 8241 ", or with letters mixed in.
  const cleaned = code.replace(/\D/g, "").slice(0, 4);

  function join() {
    if (cleaned.length === 4) navigate(`/r/${cleaned}`);
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-10 p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">QuizRoom</h1>
        <p className="mt-3 text-slate-500">
          Turn a topic or your notes into a quiz, then play it.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          join();
        }}
        className="rounded-3xl bg-slate-50 p-5"
      >
        <label htmlFor="code" className="block text-center text-sm font-medium text-slate-600">
          Got a room code?
        </label>
        <input
          id="code"
          value={cleaned}
          onChange={(event) => setCode(event.target.value)}
          // inputMode brings up the number pad on a phone, which is the whole
          // reason room codes are 4 digits.
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="0000"
          className="mt-3 w-full rounded-2xl border-2 border-slate-200 bg-white py-4 text-center font-mono text-4xl tracking-[0.3em] tabular-nums outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={cleaned.length !== 4}
          className="mt-3 w-full rounded-2xl bg-slate-900 py-4 text-lg font-bold text-white transition hover:bg-slate-700 disabled:opacity-30"
        >
          Join
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate("/create")}
          className="w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99]"
        >
          Make a quiz
        </button>
        <button
          type="button"
          onClick={() => navigate("/q/sample")}
          className="w-full rounded-2xl border-2 border-slate-200 py-4 text-lg font-medium text-slate-700 transition hover:border-slate-300"
        >
          Play the sample quiz
        </button>
      </div>

      {mine.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-widest text-slate-400 uppercase">
            Your quizzes
          </h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
            {mine.map((quiz) => (
              <li key={quiz.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/q/${quiz.id}`)}
                  className="flex w-full items-center justify-between px-4 py-4 text-left transition hover:bg-slate-50"
                >
                  <span className="truncate font-medium text-slate-800">{quiz.title}</span>
                  <span className="ml-4 shrink-0 text-sm text-slate-400">
                    {new Date(quiz.createdAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
