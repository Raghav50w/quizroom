import type { RankedPlayer } from "../../shared/game.js";
import { ShareLink } from "./ShareLink.js";

interface PodiumProps {
  ranked: RankedPlayer[];
  total: number;
  sharePath?: string;
  onPlayAgain: () => void;
  onHome: () => void;
}

export function Podium({ ranked, total, sharePath, onPlayAgain, onHome }: PodiumProps) {
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

      {sharePath && <ShareLink path={sharePath} />}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99]"
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onHome}
          className="w-full rounded-2xl border-2 border-slate-200 py-4 text-lg font-medium text-slate-700 transition hover:border-slate-300"
        >
          Make another quiz
        </button>
      </div>
    </div>
  );
}
