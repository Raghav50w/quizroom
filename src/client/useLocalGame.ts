import { useEffect, useReducer, useState } from "react";
import {
  createGame,
  reduce,
  type GameEvent,
  type GameState,
} from "../shared/game.js";
import type { Quiz } from "../shared/quiz.js";

/**
 * The local driver: the only thing standing between the pure reducer and the
 * screen. It owns the clock and nothing else.
 *
 * P4 replaces this file with a socket driver that emits the same events and
 * renders the same state. The rules never move out of shared/game.ts.
 */

export const SOLO_PLAYER_ID = "you";

export function useLocalGame(quiz: Quiz, questionDurationMs: number) {
  const [state, dispatch] = useReducer(
    reduce,
    undefined,
    (): GameState => {
      const game = createGame(quiz, { questionDurationMs });
      return reduce(game, {
        type: "player_joined",
        playerId: SOLO_PLAYER_ID,
        nickname: "You",
      });
    },
  );

  // The deadline timer. Keyed on epoch, so a transition cancels the timeout
  // belonging to the phase we just left — and the reducer's epoch guard
  // catches anything that fires anyway.
  useEffect(() => {
    if (state.phase !== "question" && state.phase !== "results") return;
    const delay = Math.max(0, state.deadlineAt - Date.now());
    const timer = setTimeout(() => {
      dispatch({ type: "advance", epoch: state.epoch, at: Date.now() });
    }, delay);
    return () => clearTimeout(timer);
  }, [state.phase, state.epoch, state.deadlineAt]);

  const msLeft = useCountdown(state.phase === "question" ? state.deadlineAt : null);

  return {
    state,
    msLeft,
    send: dispatch as (event: GameEvent) => void,
  };
}

/** Display only — the deadline is authoritative, this just paints it. */
function useCountdown(deadlineAt: number | null): number {
  const [msLeft, setMsLeft] = useState(0);

  useEffect(() => {
    if (deadlineAt === null) {
      setMsLeft(0);
      return;
    }
    const tick = () => setMsLeft(Math.max(0, deadlineAt - Date.now()));
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [deadlineAt]);

  return msLeft;
}
