import type { Snapshot } from "../../shared/socket.js";

/** Between questions: the correct answer, how you did, and the top scores. */
export function RoomResults({ snapshot }: { snapshot: Snapshot }) {
  const answered = snapshot.yourAnswer !== null;
  const correct = snapshot.yourAnswer === snapshot.correctIndex;
  const top = [...snapshot.players].sort((a, b) => b.score - a.score).slice(0, 5);

  return (
    <div className="flex h-full flex-col justify-center gap-6 p-6 text-center">
      <div>
        <p className="text-sm font-medium text-slate-400">
          {snapshot.questionIndex + 1} / {snapshot.totalQuestions}
        </p>
        <p
          className={`mt-2 text-3xl font-bold ${
            correct ? "text-emerald-600" : answered ? "text-rose-600" : "text-slate-500"
          }`}
        >
          {correct ? "Correct" : answered ? "Not quite" : "Time's up"}
        </p>
      </div>

      {snapshot.question && snapshot.correctIndex !== null && (
        <div className="rounded-2xl bg-slate-100 p-5">
          <p className="text-sm text-slate-500">{snapshot.question.stem}</p>
          <p className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">
            {snapshot.question.options[snapshot.correctIndex]}
          </p>
        </div>
      )}

      <ul className="space-y-1">
        {top.map((player) => (
          <li
            key={player.id}
            className={`flex items-center justify-between rounded-xl px-4 py-2 ${
              player.id === snapshot.yourId ? "bg-indigo-50 font-semibold" : ""
            }`}
          >
            <span className={player.connected ? "text-slate-700" : "text-slate-400"}>
              {player.nickname}
            </span>
            <span className="tabular-nums text-slate-900">{player.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
