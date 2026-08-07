import { useEffect, useState } from "react";
import type { Quiz } from "../../shared/quiz.js";
import { DEFAULT_QUESTION_DURATION_MS, rankPlayers } from "../../shared/game.js";
import { ApiError, fetchQuiz } from "../lib/api.js";
import { navigate } from "../lib/router.js";
import { Lobby } from "../screens/Lobby.js";
import { Podium } from "../screens/Podium.js";
import { Question } from "../screens/Question.js";
import { Results } from "../screens/Results.js";
import { SOLO_PLAYER_ID, useLocalGame } from "../useLocalGame.js";

/**
 * Solo mode: fetch the quiz, play it client-side, show the score. Zero database
 * writes — the run is completely ephemeral.
 */
export function Play({ quizId }: { quizId: string }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(DEFAULT_QUESTION_DURATION_MS);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQuiz(null);
    setError(null);
    fetchQuiz(quizId)
      .then(({ quiz: loaded }) => {
        if (!cancelled) setQuiz(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : "Could not reach the server.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-medium text-slate-800">{error}</p>
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

  if (!quiz) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <Game
      key={`${quizId}-${runId}-${durationMs}`}
      quiz={quiz}
      sharePath={`/q/${quizId}`}
      durationMs={durationMs}
      onDurationChange={setDurationMs}
      onPlayAgain={() => setRunId((id) => id + 1)}
    />
  );
}

interface GameProps {
  quiz: Quiz;
  sharePath: string;
  durationMs: number;
  onDurationChange: (ms: number) => void;
  onPlayAgain: () => void;
}

function Game({ quiz, sharePath, durationMs, onDurationChange, onPlayAgain }: GameProps) {
  const { state, msLeft, send } = useLocalGame(quiz, durationMs);

  const question = state.quiz.questions[state.questionIndex]!;
  const total = state.quiz.questions.length;
  const you = state.players[SOLO_PLAYER_ID]!;
  const chosenIndex = state.answers[state.questionIndex]?.[SOLO_PLAYER_ID]?.optionIndex;

  switch (state.phase) {
    case "lobby":
      return (
        <Lobby
          title={state.quiz.title}
          questionCount={total}
          questionDurationMs={durationMs}
          sharePath={sharePath}
          onDurationChange={onDurationChange}
          onStart={() => send({ type: "start", at: Date.now() })}
          onHome={() => navigate("/")}
        />
      );

    case "question":
      return (
        <Question
          question={question}
          index={state.questionIndex}
          total={total}
          score={you.score}
          msLeft={msLeft}
          durationMs={durationMs}
          chosenIndex={chosenIndex}
          onAnswer={(optionIndex) =>
            send({ type: "answer", playerId: SOLO_PLAYER_ID, optionIndex, at: Date.now() })
          }
        />
      );

    case "results":
      return (
        <Results
          question={question}
          chosenIndex={chosenIndex}
          score={you.score}
          index={state.questionIndex}
          total={total}
        />
      );

    case "ended":
      return (
        <Podium
          ranked={rankPlayers(state)}
          total={total}
          sharePath={sharePath}
          onPlayAgain={onPlayAgain}
          onHome={() => navigate("/")}
        />
      );
  }
}
