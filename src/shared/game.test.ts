import { describe, expect, it } from "vitest";
import {
  createGame,
  rankPlayers,
  reduce,
  type GameEvent,
  type GameState,
} from "./game.js";
import type { Quiz } from "./quiz.js";
import { sampleQuiz } from "./sample-quiz.js";

const QUESTION_MS = 20_000;
const RESULTS_MS = 5_000;
const T0 = 1_000_000;

function quizOf(count: number): Quiz {
  return { ...sampleQuiz, questions: sampleQuiz.questions.slice(0, count) };
}

function gameWith(playerIds: string[], questionCount = 3): GameState {
  let state = createGame(quizOf(questionCount), {
    questionDurationMs: QUESTION_MS,
    resultsDurationMs: RESULTS_MS,
  });
  for (const id of playerIds) {
    state = reduce(state, { type: "player_joined", playerId: id, nickname: id });
  }
  return state;
}

const run = (state: GameState, ...events: GameEvent[]) => events.reduce(reduce, state);

/** The correct option for the question the game is currently on. */
const correctFor = (state: GameState) =>
  state.quiz.questions[state.questionIndex]!.correctIndex;
const wrongFor = (state: GameState) => (correctFor(state) + 1) % 4;

describe("lobby", () => {
  it("starts on the first question", () => {
    const state = run(gameWith(["a"]), { type: "start", at: T0 });
    expect(state.phase).toBe("question");
    expect(state.questionIndex).toBe(0);
    expect(state.deadlineAt).toBe(T0 + QUESTION_MS);
  });

  it("blocks late join once the game is running", () => {
    const started = run(gameWith(["a"]), { type: "start", at: T0 });
    const after = reduce(started, { type: "player_joined", playerId: "b", nickname: "b" });
    expect(Object.keys(after.players)).toEqual(["a"]);
  });

  it("ignores a second start", () => {
    const started = run(gameWith(["a"]), { type: "start", at: T0 });
    expect(reduce(started, { type: "start", at: T0 + 5_000 })).toBe(started);
  });
});

describe("answering", () => {
  it("scores a correct answer and records response time", () => {
    let state = run(gameWith(["a"]), { type: "start", at: T0 });
    state = reduce(state, {
      type: "answer",
      playerId: "a",
      optionIndex: correctFor(state),
      at: T0 + 3_000,
    });
    expect(state.players.a!.score).toBe(1);
    expect(state.players.a!.totalResponseTimeMs).toBe(3_000);
  });

  it("ignores a second answer from the same player", () => {
    let state = run(gameWith(["a", "b"]), { type: "start", at: T0 });
    const first = reduce(state, {
      type: "answer",
      playerId: "a",
      optionIndex: correctFor(state),
      at: T0 + 1_000,
    });
    const second = reduce(first, {
      type: "answer",
      playerId: "a",
      optionIndex: wrongFor(state),
      at: T0 + 2_000,
    });
    expect(second).toBe(first);
    expect(second.players.a!.score).toBe(1);
  });

  it("ignores an out-of-range option", () => {
    const state = run(gameWith(["a"]), { type: "start", at: T0 });
    expect(reduce(state, { type: "answer", playerId: "a", optionIndex: 4, at: T0 })).toBe(state);
  });

  it("ignores answers outside the question phase", () => {
    const lobby = gameWith(["a"]);
    expect(reduce(lobby, { type: "answer", playerId: "a", optionIndex: 0, at: T0 })).toBe(lobby);
  });

  it("cuts the timer short once everyone connected has answered", () => {
    let state = run(gameWith(["a", "b"]), { type: "start", at: T0 });
    state = reduce(state, {
      type: "answer",
      playerId: "a",
      optionIndex: correctFor(state),
      at: T0 + 1_000,
    });
    expect(state.phase).toBe("question");
    state = reduce(state, {
      type: "answer",
      playerId: "b",
      optionIndex: correctFor(state),
      at: T0 + 2_000,
    });
    expect(state.phase).toBe("results");
    expect(state.deadlineAt).toBe(T0 + 2_000 + RESULTS_MS);
  });
});

describe("the epoch guard", () => {
  it("ignores an advance carrying a stale epoch", () => {
    // The exact race: everyone answers early, then the deadline timeout for the
    // question we already left fires. Without the guard it skips a question.
    let state = run(gameWith(["a"]), { type: "start", at: T0 });
    const staleEpoch = state.epoch;
    state = reduce(state, {
      type: "answer",
      playerId: "a",
      optionIndex: correctFor(state),
      at: T0 + 1_000,
    });
    expect(state.phase).toBe("results");

    const after = reduce(state, { type: "advance", epoch: staleEpoch, at: T0 + QUESTION_MS });
    expect(after).toBe(state);
    expect(after.questionIndex).toBe(0);
  });

  it("bumps the epoch on every transition", () => {
    const start = run(gameWith(["a"]), { type: "start", at: T0 });
    const results = reduce(start, { type: "advance", epoch: start.epoch, at: T0 + QUESTION_MS });
    expect(results.epoch).toBeGreaterThan(start.epoch);
  });
});

describe("deadline and progression", () => {
  it("charges the full timer to a connected player who did not answer", () => {
    const start = run(gameWith(["a"]), { type: "start", at: T0 });
    const results = reduce(start, { type: "advance", epoch: start.epoch, at: T0 + QUESTION_MS });
    expect(results.players.a!.score).toBe(0);
    expect(results.players.a!.totalResponseTimeMs).toBe(QUESTION_MS);
  });

  it("walks every question and then ends", () => {
    let state = run(gameWith(["a"], 3), { type: "start", at: T0 });
    let now = T0;
    for (let i = 0; i < 3; i++) {
      expect(state.phase).toBe("question");
      expect(state.questionIndex).toBe(i);
      now += QUESTION_MS;
      state = reduce(state, { type: "advance", epoch: state.epoch, at: now });
      expect(state.phase).toBe("results");
      now += RESULTS_MS;
      state = reduce(state, { type: "advance", epoch: state.epoch, at: now });
    }
    expect(state.phase).toBe("ended");
  });

  it("handles a one-question quiz", () => {
    let state = run(gameWith(["a"], 1), { type: "start", at: T0 });
    state = reduce(state, { type: "advance", epoch: state.epoch, at: T0 + QUESTION_MS });
    state = reduce(state, { type: "advance", epoch: state.epoch, at: T0 + QUESTION_MS + RESULTS_MS });
    expect(state.phase).toBe("ended");
  });
});

describe("disconnects", () => {
  it("advances when the last unanswered player drops", () => {
    let state = run(gameWith(["a", "b"]), { type: "start", at: T0 });
    state = reduce(state, {
      type: "answer",
      playerId: "a",
      optionIndex: correctFor(state),
      at: T0 + 1_000,
    });
    expect(state.phase).toBe("question");
    // b locks their phone. The room must not wait out the full timer.
    state = reduce(state, { type: "player_disconnected", playerId: "b" });
    expect(state.phase).toBe("results");
  });

  it("keeps a disconnected player's score and lets them rejoin", () => {
    let state = run(gameWith(["a", "b"]), { type: "start", at: T0 });
    state = reduce(state, {
      type: "answer",
      playerId: "b",
      optionIndex: correctFor(state),
      at: T0 + 1_000,
    });
    state = reduce(state, { type: "player_disconnected", playerId: "b" });
    expect(state.players.b!.connected).toBe(false);
    expect(state.players.b!.score).toBe(1);
    state = reduce(state, { type: "player_reconnected", playerId: "b" });
    expect(state.players.b!.connected).toBe(true);
    expect(state.players.b!.score).toBe(1);
  });

  it("waits for the deadline when every player has dropped", () => {
    let state = run(gameWith(["a"]), { type: "start", at: T0 });
    state = reduce(state, { type: "player_disconnected", playerId: "a" });
    expect(state.phase).toBe("question");
  });
});

describe("rankPlayers", () => {
  it("ranks by score, then by total response time", () => {
    let state = gameWith(["slow", "fast", "zero"]);
    state = reduce(state, { type: "start", at: T0 });
    state = reduce(state, {
      type: "answer",
      playerId: "slow",
      optionIndex: correctFor(state),
      at: T0 + 9_000,
    });
    state = reduce(state, {
      type: "answer",
      playerId: "fast",
      optionIndex: correctFor(state),
      at: T0 + 1_000,
    });
    state = reduce(state, {
      type: "answer",
      playerId: "zero",
      optionIndex: wrongFor(state),
      at: T0 + 500,
    });

    const ranked = rankPlayers(state);
    expect(ranked.map((player) => player.id)).toEqual(["fast", "slow", "zero"]);
    expect(ranked.map((player) => player.rank)).toEqual([1, 2, 3]);
  });

  it("gives tied players the same rank", () => {
    const state = gameWith(["a", "b"]);
    expect(rankPlayers(state).map((player) => player.rank)).toEqual([1, 1]);
  });

  it("is deterministic when scores and times all tie", () => {
    const state = gameWith(["b", "a", "c"]);
    expect(rankPlayers(state).map((player) => player.id)).toEqual(["a", "b", "c"]);
  });

  it("handles a single player", () => {
    expect(rankPlayers(gameWith(["a"]))).toHaveLength(1);
  });
});
