import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleQuiz } from "../shared/sample-quiz.js";
import {
  _resetRooms,
  applyEvent,
  createRoom,
  getRoom,
  joinRoom,
  playerIdForToken,
  snapshotFor,
} from "./rooms.js";

const QUESTION_MS = 20_000;

beforeEach(() => {
  _resetRooms();
  vi.useFakeTimers();
});

afterEach(() => {
  _resetRooms();
  vi.useRealTimers();
});

const newRoom = () => createRoom(sampleQuiz, QUESTION_MS);

describe("room codes", () => {
  it("issues a 4-digit numeric code", () => {
    expect(newRoom().code).toMatch(/^\d{4}$/);
  });

  it("never issues the same code twice", () => {
    const codes = new Set(Array.from({ length: 300 }, () => newRoom().code));
    expect(codes.size).toBe(300);
  });

  it("is findable by its code", () => {
    const room = newRoom();
    expect(getRoom(room.code)).toBe(room);
  });
});

describe("joining", () => {
  it("issues distinct nicknames so two BraveOtters can't appear", () => {
    const room = newRoom();
    const names = new Set<string>();
    for (let i = 0; i < 16; i++) {
      joinRoom(room);
      names.add(Object.values(room.state.players).at(-1)!.nickname);
    }
    expect(names.size).toBe(16);
  });

  it("issues a distinct token per player", () => {
    const room = newRoom();
    const a = joinRoom(room)!;
    const b = joinRoom(room)!;
    expect(a.playerToken).not.toBe(b.playerToken);
    expect(playerIdForToken(room, a.playerToken)).toBe(a.playerId);
  });

  it("blocks a newcomer once the game has started", () => {
    const room = newRoom();
    joinRoom(room);
    applyEvent(room, { type: "start", at: Date.now() });
    expect(joinRoom(room)).toBeNull();
  });

  it("lets a known token rejoin mid-game with its score intact", () => {
    const room = newRoom();
    const player = joinRoom(room)!;
    applyEvent(room, { type: "start", at: Date.now() });
    const correct = sampleQuiz.questions[0]!.correctIndex;
    applyEvent(room, {
      type: "answer",
      playerId: player.playerId,
      optionIndex: correct,
      at: Date.now(),
    });
    applyEvent(room, { type: "player_disconnected", playerId: player.playerId });

    const back = joinRoom(room, player.playerToken)!;
    expect(back.reconnected).toBe(true);
    expect(back.playerId).toBe(player.playerId);
    expect(room.state.players[player.playerId]!.score).toBe(1);
    expect(room.state.players[player.playerId]!.connected).toBe(true);
  });
});

describe("the deadline timer", () => {
  it("advances to results when the question deadline passes", () => {
    const room = newRoom();
    joinRoom(room);
    applyEvent(room, { type: "start", at: Date.now() });
    expect(room.state.phase).toBe("question");

    vi.advanceTimersByTime(QUESTION_MS + 10);
    expect(room.state.phase).toBe("results");
  });

  it("does not skip a question when everyone answers early", () => {
    // The exact race the epoch guard exists for: the early advance clears the
    // timeout, and a stale one firing anyway must be a no-op.
    const room = newRoom();
    const player = joinRoom(room)!;
    applyEvent(room, { type: "start", at: Date.now() });

    applyEvent(room, {
      type: "answer",
      playerId: player.playerId,
      optionIndex: sampleQuiz.questions[0]!.correctIndex,
      at: Date.now(),
    });
    expect(room.state.phase).toBe("results");

    // Run out the clock the original question would have had.
    vi.advanceTimersByTime(QUESTION_MS + 10);
    expect(room.state.questionIndex).toBe(1);
    expect(room.state.phase).toBe("question");
  });

  it("walks the whole quiz on timers alone and ends", () => {
    const room = newRoom();
    joinRoom(room);
    applyEvent(room, { type: "start", at: Date.now() });

    for (let i = 0; i < sampleQuiz.questions.length; i++) {
      vi.advanceTimersByTime(QUESTION_MS + 10);
      vi.advanceTimersByTime(5_000 + 10);
    }
    expect(room.state.phase).toBe("ended");
  });

  it("cuts the timer short when the last unanswered player drops", () => {
    const room = newRoom();
    const a = joinRoom(room)!;
    const b = joinRoom(room)!;
    applyEvent(room, { type: "start", at: Date.now() });
    applyEvent(room, {
      type: "answer",
      playerId: a.playerId,
      optionIndex: 0,
      at: Date.now(),
    });
    expect(room.state.phase).toBe("question");

    applyEvent(room, { type: "player_disconnected", playerId: b.playerId });
    expect(room.state.phase).toBe("results");
  });
});

describe("snapshots", () => {
  it("hides the correct answer while the question is live", () => {
    const room = newRoom();
    const player = joinRoom(room)!;
    applyEvent(room, { type: "start", at: Date.now() });

    const during = snapshotFor(room, player.playerId, true);
    expect(during.phase).toBe("question");
    expect(during.question).not.toBeNull();
    // Sending it early would put the answer in the browser's network tab.
    expect(during.correctIndex).toBeNull();
  });

  it("reveals the correct answer once results are showing", () => {
    const room = newRoom();
    const player = joinRoom(room)!;
    applyEvent(room, { type: "start", at: Date.now() });
    vi.advanceTimersByTime(QUESTION_MS + 10);

    const after = snapshotFor(room, player.playerId, true);
    expect(after.phase).toBe("results");
    expect(after.correctIndex).toBe(sampleQuiz.questions[0]!.correctIndex);
  });

  it("reports each player's own answer", () => {
    const room = newRoom();
    const a = joinRoom(room)!;
    const b = joinRoom(room)!;
    applyEvent(room, { type: "start", at: Date.now() });
    applyEvent(room, { type: "answer", playerId: a.playerId, optionIndex: 2, at: Date.now() });

    expect(snapshotFor(room, a.playerId, true).yourAnswer).toBe(2);
    expect(snapshotFor(room, b.playerId, false).yourAnswer).toBeNull();
  });
});
