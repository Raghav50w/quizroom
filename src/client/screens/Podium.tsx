import type { RankedPlayer } from "../../shared/game.js";

interface PodiumProps {
  ranked: RankedPlayer[];
  total: number;
  onPlayAgain: () => void;
}

export function Podium({ ranked, total, onPlayAgain }: PodiumProps) {
  const you = ranked[0]!;

  return (
    <div className="flex h-full flex-col justify-center gap-8 p-6 text-center">
      <div>
        <p className="text-sm font-medium tracking-widest text-slate-400 uppercase">Final score</p>
        <p className="mt-3 text-6xl font-bold text-slate-900 tabular-nums">
          {you.score}
          <span className="text-3xl text-slate-400">/{total}</span>
        </p>
        <p className="mt-3 text-slate-500">
          {(you.totalResponseTimeMs / 1000).toFixed(1)}s total answer time
        </p>
      </div>

      <button
        type="button"
        onClick={onPlayAgain}
        className="w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition active:scale-[0.99] hover:bg-indigo-700"
      >
        Play again
      </button>
    </div>
  );
}
