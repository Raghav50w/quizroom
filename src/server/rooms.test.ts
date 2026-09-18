import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleQuiz } from "../shared/sample-quiz.js";
import { applyEvent, createRoom, isRejection, joinRoom, snapshotFor } from "./rooms.js";

const QUESTION_MS = 20_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Join and assert it succeeded, so the tests below stay about behaviour. */
function join(room: ReturnType<typeof createRoom>) {
  const result = joinRoom(room, undefined);
  if (isRejection(result)) throw new Error(`unexpected rejection: ${result.rejected}`);
  return result;
}

describe("rooms", () => {
  it("does not skip a question when everyone answers early", () => {
    // The exact race the epoch guard exists for: the early advance clears the
    // timeout, and a stale one firing anyway must be a no-op.
    const room = createRoom(sampleQuiz, QUESTION_MS);
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

  it("hides the correct answer while the question is live", () => {
    const room = createRoom(sampleQuiz, QUESTION_MS);
    const player = join(room);
    applyEvent(room, { type: "start", at: Date.now() });

    const during = snapshotFor(room, player.playerId, true);
    expect(during.phase).toBe("question");
    expect(during.question).not.toBeNull();
    // Sending it early would put the answer in the browser's network tab.
    expect(during.correctIndex).toBeNull();
  });
});
