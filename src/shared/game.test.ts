import { describe, expect, it } from "vitest";
import { createGame, reduce, type GameEvent, type GameState } from "./game.js";
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

describe("game reducer", () => {
  it("starts on the first question", () => {
    const state = run(gameWith(["a"]), { type: "start", at: T0 });
    expect(state.phase).toBe("question");
    expect(state.questionIndex).toBe(0);
    expect(state.deadlineAt).toBe(T0 + QUESTION_MS);
  });

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
    expect(state.answers[0]!.a!.correct).toBe(true);
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
});
