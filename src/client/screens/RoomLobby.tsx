import type { Snapshot } from "../../shared/socket.js";

interface RoomLobbyProps {
  snapshot: Snapshot;
  onStart: () => void;
}

/**
 * The code is the whole screen. People are reading it off a laptop and typing
 * it into a phone, so it wants to be large and unambiguous.
 */
export function RoomLobby({ snapshot, onStart }: RoomLobbyProps) {
  const connected = snapshot.players.filter((player) => player.connected);

  return (
    <div className="flex h-full flex-col justify-center gap-8 p-6 text-center">
      <div>
        <p className="text-sm font-medium tracking-widest text-slate-400 uppercase">
          Join at this code
        </p>
        <p className="mt-2 font-mono text-7xl font-bold tracking-[0.2em] text-slate-900 tabular-nums sm:text-8xl">
          {snapshot.code}
        </p>
        <p className="mt-4 text-slate-500">{snapshot.quizTitle}</p>
        <p className="text-sm text-slate-400">{snapshot.totalQuestions} questions</p>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-600">
          {connected.length} {connected.length === 1 ? "player" : "players"} in
        </p>
        <ul className="flex flex-wrap justify-center gap-2">
          {snapshot.players.map((player) => (
            <li
              key={player.id}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                player.connected
                  ? "bg-indigo-50 text-indigo-800"
                  : "bg-slate-100 text-slate-400 line-through"
              }`}
            >
              {player.nickname}
              {player.id === snapshot.yourId && " (you)"}
            </li>
          ))}
        </ul>
      </div>

      {snapshot.isHost ? (
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99]"
        >
          Start the game
        </button>
      ) : (
        <p className="rounded-2xl bg-slate-50 py-5 text-lg font-medium text-slate-500">
          Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
