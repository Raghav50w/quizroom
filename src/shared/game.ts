import type { Quiz } from "./quiz.js";

/**
 * The game as a pure function: (state, event) => state. No I/O, no timers, no
 * sockets, no randomness.
 *
 * P2 drives this from a local React hook; P4 drives the identical reducer from
 * the server with a socket driver. That is the whole point — the riskiest logic
 * in the project is exercised from P2 onward, and P4 swaps the driver rather
 * than rewriting the rules.
 *
 * Browser-safe: lives in shared/, imports nothing Node-only.
 */

export type Phase = "lobby" | "question" | "results" | "ended";

export interface Player {
  id: string;
  nickname: string;
  connected: boolean;
  score: number;
  /** Unanswered questions contribute the full timer, so skipping can't win the tiebreak. */
  totalResponseTimeMs: number;
}

export interface AnswerRecord {
  optionIndex: number;
  responseTimeMs: number;
  correct: boolean;
}

export interface GameState {
  phase: Phase;
  quiz: Quiz;
  questionIndex: number;
  /**
   * Bumped on every phase transition. An `advance` carrying a stale epoch is
   * ignored — without this, an early advance and the deadline timeout both fire
   * and the room skips a question.
   */
  epoch: number;
  /** Absolute UTC epoch ms, never a duration — no clock-offset estimation. */
  deadlineAt: number;
  questionDurationMs: number;
  resultsDurationMs: number;
  players: Record<string, Player>;
  /** questionIndex -> playerId -> answer */
  answers: Record<number, Record<string, AnswerRecord>>;
}

export type GameEvent =
  | { type: "player_joined"; playerId: string; nickname: string }
  | { type: "player_disconnected"; playerId: string }
  | { type: "player_reconnected"; playerId: string }
  | { type: "start"; at: number }
  | { type: "answer"; playerId: string; optionIndex: number; at: number }
  /** Fired by the deadline timer, or by the driver to move on from results. */
  | { type: "advance"; epoch: number; at: number };

export const DEFAULT_QUESTION_DURATION_MS = 20_000;
export const DEFAULT_RESULTS_DURATION_MS = 5_000;

export function createGame(
  quiz: Quiz,
  options: { questionDurationMs?: number; resultsDurationMs?: number } = {},
): GameState {
  return {
    phase: "lobby",
    quiz,
    questionIndex: 0,
    epoch: 0,
    deadlineAt: 0,
    questionDurationMs: options.questionDurationMs ?? DEFAULT_QUESTION_DURATION_MS,
    resultsDurationMs: options.resultsDurationMs ?? DEFAULT_RESULTS_DURATION_MS,
    players: {},
    answers: {},
  };
}

export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player_joined":
      // Late join is blocked: the lobby is the only door.
      if (state.phase !== "lobby" || state.players[event.playerId]) return state;
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: {
            id: event.playerId,
            nickname: event.nickname,
            connected: true,
            score: 0,
            totalResponseTimeMs: 0,
          },
        },
      };

    case "player_disconnected": {
      const player = state.players[event.playerId];
      if (!player || !player.connected) return state;
      const next = setPlayer(state, { ...player, connected: false });
      // Re-check here too: otherwise the last unanswered player locking their
      // phone makes everyone wait out the full timer.
      return maybeEndQuestion(next, state.deadlineAt);
    }

    case "player_reconnected": {
      const player = state.players[event.playerId];
      if (!player || player.connected) return state;
      return setPlayer(state, { ...player, connected: true });
    }

    case "start":
      if (state.phase !== "lobby") return state;
      return openQuestion(state, 0, event.at);

    case "answer": {
      if (state.phase !== "question") return state;
      const player = state.players[event.playerId];
      if (!player) return state;

      const forQuestion = state.answers[state.questionIndex] ?? {};
      if (forQuestion[event.playerId]) return state; // one answer per question

      const question = state.quiz.questions[state.questionIndex];
      if (!question) return state;
      if (!Number.isInteger(event.optionIndex)) return state;
      if (event.optionIndex < 0 || event.optionIndex > 3) return state;

      const responseTimeMs = clampResponseTime(state, event.at);
      const correct = event.optionIndex === question.correctIndex;

      const withAnswer: GameState = {
        ...state,
        answers: {
          ...state.answers,
          [state.questionIndex]: {
            ...forQuestion,
            [event.playerId]: { optionIndex: event.optionIndex, responseTimeMs, correct },
          },
        },
        players: {
          ...state.players,
          [event.playerId]: {
            ...player,
            score: player.score + (correct ? 1 : 0),
            totalResponseTimeMs: player.totalResponseTimeMs + responseTimeMs,
          },
        },
      };

      return maybeEndQuestion(withAnswer, event.at);
    }

    case "advance": {
      // The epoch guard. A timeout from a question we already left is a no-op.
      if (event.epoch !== state.epoch) return state;
      if (state.phase === "question") return closeQuestion(state, event.at);
      if (state.phase === "results") {
        const nextIndex = state.questionIndex + 1;
        return nextIndex >= state.quiz.questions.length
          ? { ...state, phase: "ended", epoch: state.epoch + 1, deadlineAt: event.at }
          : openQuestion(state, nextIndex, event.at);
      }
      return state;
    }
  }
}

/** Answers land while phase === 'question'; the phase itself is the grace window. */
function clampResponseTime(state: GameState, at: number): number {
  const elapsed = at - (state.deadlineAt - state.questionDurationMs);
  return Math.max(0, Math.min(elapsed, state.questionDurationMs));
}

function setPlayer(state: GameState, player: Player): GameState {
  return { ...state, players: { ...state.players, [player.id]: player } };
}

function openQuestion(state: GameState, index: number, at: number): GameState {
  return {
    ...state,
    phase: "question",
    questionIndex: index,
    epoch: state.epoch + 1,
    deadlineAt: at + state.questionDurationMs,
  };
}

/**
 * Everyone still connected has answered — cut the timer short.
 * A room where every player has dropped keeps waiting for the deadline rather
 * than racing to the podium.
 */
function maybeEndQuestion(state: GameState, at: number): GameState {
  if (state.phase !== "question") return state;
  const connected = Object.values(state.players).filter((player) => player.connected);
  if (connected.length === 0) return state;

  const answered = state.answers[state.questionIndex] ?? {};
  const allAnswered = connected.every((player) => answered[player.id]);
  return allAnswered ? closeQuestion(state, at) : state;
}

/** Unanswered counts as the full timer duration, for connected players only. */
function closeQuestion(state: GameState, at: number): GameState {
  const answered = state.answers[state.questionIndex] ?? {};
  const players = { ...state.players };

  for (const player of Object.values(state.players)) {
    if (player.connected && !answered[player.id]) {
      players[player.id] = {
        ...player,
        totalResponseTimeMs: player.totalResponseTimeMs + state.questionDurationMs,
      };
    }
  }

  return {
    ...state,
    phase: "results",
    epoch: state.epoch + 1,
    deadlineAt: at + state.resultsDurationMs,
    players,
  };
}

export interface RankedPlayer extends Player {
  rank: number;
}

/**
 * Score desc, then total response time asc, then player id — the last one only
 * so the order is deterministic when everything else ties.
 */
export function rankPlayers(state: GameState): RankedPlayer[] {
  const sorted = Object.values(state.players).sort(
    (a, b) =>
      b.score - a.score ||
      a.totalResponseTimeMs - b.totalResponseTimeMs ||
      a.id.localeCompare(b.id),
  );

  let rank = 0;
  let previous: Player | undefined;
  return sorted.map((player, position) => {
    const tied =
      previous !== undefined &&
      previous.score === player.score &&
      previous.totalResponseTimeMs === player.totalResponseTimeMs;
    rank = tied ? rank : position + 1;
    previous = player;
    return { ...player, rank };
  });
}

/** Per-question accuracy for the results screen. */
export function questionAccuracy(state: GameState, questionIndex: number): number {
  const answers = Object.values(state.answers[questionIndex] ?? {});
  if (answers.length === 0) return 0;
  return answers.filter((answer) => answer.correct).length / answers.length;
}
