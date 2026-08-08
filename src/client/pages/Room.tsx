import { navigate } from "../lib/router.js";
import { Question } from "../screens/Question.js";
import { RoomLobby } from "../screens/RoomLobby.js";
import { RoomPodium } from "../screens/RoomPodium.js";
import { RoomResults } from "../screens/RoomResults.js";
import { useRoom } from "../useRoom.js";

/**
 * Multiplayer. Every screen after the lobby is identical for everyone,
 * host included — there is no presenter mode, and once the game starts the
 * host is just a player.
 */
export function Room({ code }: { code: string }) {
  const { snapshot, stats, error, msLeft, start, answer } = useRoom(code);

  if (error && !snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-medium text-slate-800">{error.message}</p>
        <p className="text-sm text-slate-500">
          {error.code === "ROOM_GONE"
            ? "Rooms don't survive a server restart. Ask the host to open a new one."
            : ""}
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-xl bg-slate-900 px-6 py-3 font-medium text-white"
        >
          Home
        </button>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-slate-400">Joining room {code}…</p>
      </div>
    );
  }

  switch (snapshot.phase) {
    case "lobby":
      return <RoomLobby snapshot={snapshot} onStart={start} />;

    case "question":
      return snapshot.question ? (
        <Question
          question={{
            id: `q${snapshot.questionIndex}`,
            stem: snapshot.question.stem,
            options: snapshot.question.options,
            // The server withholds the answer until results; the play screen
            // never needs it, it only marks which option you tapped.
            correctIndex: 0,
            origin: "ai",
          }}
          index={snapshot.questionIndex}
          total={snapshot.totalQuestions}
          score={snapshot.players.find((p) => p.id === snapshot.yourId)?.score ?? 0}
          msLeft={msLeft}
          durationMs={snapshot.questionDurationMs}
          chosenIndex={snapshot.yourAnswer ?? undefined}
          onAnswer={answer}
        />
      ) : null;

    case "results":
      return <RoomResults snapshot={snapshot} />;

    case "ended":
      return <RoomPodium snapshot={snapshot} stats={stats} onHome={() => navigate("/")} />;
  }
}
