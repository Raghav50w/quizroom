import { listMyQuizzes } from "../lib/myQuizzes.js";
import { navigate } from "../lib/router.js";

/**
 * Join is a dead end until P4, so it stays hidden. Create is the visible path,
 * because a recruiter arrives with no room code.
 */
export function Landing() {
  const mine = listMyQuizzes();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-10 p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">QuizRoom</h1>
        <p className="mt-3 text-slate-500">
          Turn a topic or your notes into a quiz, then play it.
        </p>
      </div>

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
