import type { GameStats, Snapshot } from "../../shared/socket.js";

interface RoomPodiumProps {
  snapshot: Snapshot;
  stats: GameStats | null;
  onHome: () => void;
}

/** Podium, then stats. The room closes after — no rematch. */
export function RoomPodium({ snapshot, stats, onHome }: RoomPodiumProps) {
  const ranked = [...snapshot.players].sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="flex min-h-full flex-col gap-8 overflow-y-auto p-6">
      <div className="text-center">
        <p className="text-sm font-medium tracking-widest text-slate-400 uppercase">Final</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{snapshot.quizTitle}</h1>
      </div>

      <ol className="space-y-2">
        {ranked.map((player, index) => (
          <li
            key={player.id}
            className={`flex items-center gap-3 rounded-2xl px-4 py-4 ${
              player.id === snapshot.yourId
                ? "bg-indigo-600 text-white"
                : "bg-slate-50 text-slate-800"
            }`}
          >
            <span className="w-8 text-center text-lg">{medals[index] ?? index + 1}</span>
            <span className="flex-1 truncate font-medium">
              {player.nickname}
              {player.id === snapshot.yourId && " (you)"}
            </span>
            <span className="font-bold tabular-nums">
              {player.score}
              <span
                className={player.id === snapshot.yourId ? "text-indigo-200" : "text-slate-400"}
              >
                /{snapshot.totalQuestions}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {stats && (
        <div>
          <h2 className="mb-3 text-sm font-medium tracking-widest text-slate-400 uppercase">
            How the questions went
          </h2>

          {stats.hardest && stats.easiest && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-rose-50 p-4">
                <p className="text-xs font-semibold tracking-wide text-rose-700 uppercase">
                  Hardest
                </p>
                <p className="mt-1 text-sm text-rose-900">{stats.hardest.stem}</p>
                <p className="mt-1 text-sm font-bold text-rose-700">
                  {Math.round(stats.hardest.accuracy * 100)}% got it
                </p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-4">
                <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">
                  Easiest
                </p>
                <p className="mt-1 text-sm text-emerald-900">{stats.easiest.stem}</p>
                <p className="mt-1 text-sm font-bold text-emerald-700">
                  {Math.round(stats.easiest.accuracy * 100)}% got it
                </p>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {stats.questions.map((question) => (
              <li key={question.questionIndex} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex-1 text-sm text-slate-700">
                    {question.questionIndex + 1}. {question.stem}
                  </p>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-500">
                    {question.correctCount}/{question.answerCount}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-indigo-500"
                    style={{ width: `${question.accuracy * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onHome}
        className="mb-4 w-full shrink-0 rounded-2xl border-2 border-slate-200 py-4 text-lg font-medium text-slate-700 transition hover:border-slate-300"
      >
        Home
      </button>
    </div>
  );
}
