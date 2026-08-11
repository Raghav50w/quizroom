import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleQuiz } from "../shared/sample-quiz.js";
import {
  MAX_PLAYERS,
  _resetRooms,
  applyEvent,
  createRoom,
  getRoom,
  isRejection,
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

/** Join and assert it succeeded, so the tests below stay about behaviour. */
function join(room: ReturnType<typeof newRoom>, token?: string) {
  const result = joinRoom(room, token);
  if (isRejection(result)) throw new Error(`unexpected rejection: ${result.rejected}`);
  return result;
}

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
    for (let i = 0; i < MAX_PLAYERS; i++) {
      join(room);
      names.add(Object.values(room.state.players).at(-1)!.nickname);
    }
    expect(names.size).toBe(MAX_PLAYERS);
  });

  it("refuses a ninth player", () => {
    const room = newRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) join(room);
    const extra = joinRoom(room);
    expect(isRejection(extra) && extra.rejected).toBe("ROOM_FULL");
    expect(Object.keys(room.state.players)).toHaveLength(MAX_PLAYERS);
  });

  it("still lets a known token back into a full room", () => {
    // Reconnect is checked before the cap — a player who dropped must never be
    // locked out of a game they are already in.
    const room = newRoom();
    const first = join(room);
    for (let i = 1; i < MAX_PLAYERS; i++) join(room);
    applyEvent(room, { type: "player_disconnected", playerId: first.playerId });

    const back = join(room, first.playerToken);
    expect(back.reconnected).toBe(true);
    expect(back.playerId).toBe(first.playerId);
  });

  it("issues a distinct token per player", () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    expect(a.playerToken).not.toBe(b.playerToken);
    expect(playerIdForToken(room, a.playerToken)).toBe(a.playerId);
  });

  it("blocks a newcomer once the game has started", () => {
    const room = newRoom();
    join(room);
    applyEvent(room, { type: "start", at: Date.now() });
    const late = joinRoom(room);
    expect(isRejection(late) && late.rejected).toBe("GAME_STARTED");
  });

  it("lets a known token rejoin mid-game with its score intact", () => {
    const room = newRoom();
    const player = join(room);
    applyEvent(room, { type: "start", at: Date.now() });
    const correct = sampleQuiz.questions[0]!.correctIndex;
    applyEvent(room, {
      type: "answer",
      playerId: player.playerId,
      optionIndex: correct,
      at: Date.now(),
    });
    applyEvent(room, { type: "player_disconnected", playerId: player.playerId });

    const back = join(room, player.playerToken);
    expect(back.reconnected).toBe(true);
    expect(back.playerId).toBe(player.playerId);
    expect(room.state.players[player.playerId]!.score).toBe(1);
    expect(room.state.players[player.playerId]!.connected).toBe(true);
  });
});

describe("the deadline timer", () => {
  it("advances to results when the question deadline passes", () => {
    const room = newRoom();
    join(room);
    applyEvent(room, { type: "start", at: Date.now() });
    expect(room.state.phase).toBe("question");

    vi.advanceTimersByTime(QUESTION_MS + 10);
    expect(room.state.phase).toBe("results");
  });

  it("does not skip a question when everyone answers early", () => {
    // The exact race the epoch guard exists for: the early advance clears the
    // timeout, and a stale one firing anyway must be a no-op.
    const room = newRoom();
    const player = join(room);
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
    join(room);
    applyEvent(room, { type: "start", at: Date.now() });

    for (let i = 0; i < sampleQuiz.questions.length; i++) {
      vi.advanceTimersByTime(QUESTION_MS + 10);
      vi.advanceTimersByTime(5_000 + 10);
    }
    expect(room.state.phase).toBe("ended");
  });

  it("cuts the timer short when the last unanswered player drops", () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
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
    const player = join(room);
    applyEvent(room, { type: "start", at: Date.now() });

    const during = snapshotFor(room, player.playerId, true);
    expect(during.phase).toBe("question");
    expect(during.question).not.toBeNull();
    // Sending it early would put the answer in the browser's network tab.
    expect(during.correctIndex).toBeNull();
  });

  it("reveals the correct answer once results are showing", () => {
    const room = newRoom();
    const player = join(room);
    applyEvent(room, { type: "start", at: Date.now() });
    vi.advanceTimersByTime(QUESTION_MS + 10);

    const after = snapshotFor(room, player.playerId, true);
    expect(after.phase).toBe("results");
    expect(after.correctIndex).toBe(sampleQuiz.questions[0]!.correctIndex);
  });

  it("carries the server clock so a skewed client can still count down", () => {
    const room = newRoom();
    const player = join(room);
    applyEvent(room, { type: "start", at: Date.now() });

    const snap = snapshotFor(room, player.playerId, true);
    // What the client must use. Subtracting its own Date.now() instead would
    // show 28s on a 20s timer for a machine running 8 seconds behind.
    expect(snap.deadlineAt - snap.serverNow).toBeCloseTo(QUESTION_MS, -2);

    const skewedClientNow = snap.serverNow - 8_000;
    expect(snap.deadlineAt - skewedClientNow).toBeGreaterThan(QUESTION_MS);
  });

  it("reports each player's own answer", () => {
    const room = newRoom();
    const a = join(room);
    const b = join(room);
    applyEvent(room, { type: "start", at: Date.now() });
    applyEvent(room, { type: "answer", playerId: a.playerId, optionIndex: 2, at: Date.now() });

    expect(snapshotFor(room, a.playerId, true).yourAnswer).toBe(2);
    expect(snapshotFor(room, b.playerId, false).yourAnswer).toBeNull();
  });
});
