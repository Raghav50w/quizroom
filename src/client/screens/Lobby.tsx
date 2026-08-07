interface LobbyProps {
  title: string;
  questionCount: number;
  questionDurationMs: number;
  onDurationChange: (ms: number) => void;
  onStart: () => void;
}

const DURATIONS = [10_000, 20_000, 30_000];

export function Lobby({
  title,
  questionCount,
  questionDurationMs,
  onDurationChange,
  onStart,
}: LobbyProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-8 p-6">
      <div className="text-center">
        <p className="text-sm font-medium tracking-widest text-slate-400 uppercase">QuizRoom</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900 sm:text-5xl">{title}</h1>
        <p className="mt-2 text-slate-500">{questionCount} questions</p>
      </div>

      <div>
        <p className="mb-2 text-center text-sm font-medium text-slate-600">Seconds per question</p>
        <div className="flex justify-center gap-2">
          {DURATIONS.map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => onDurationChange(ms)}
              className={`w-20 rounded-xl border-2 py-3 text-lg font-semibold transition ${
                ms === questionDurationMs
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {ms / 1000}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition active:scale-[0.99] hover:bg-indigo-700"
      >
        Play
      </button>
    </div>
  );
}
