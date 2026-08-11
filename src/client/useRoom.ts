import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type GameStats,
  type Snapshot,
  type SocketError,
} from "../shared/socket.js";
import { getRoomTokens, saveRoomTokens } from "./lib/roomTokens.js";

/**
 * The socket driver — the multiplayer counterpart to useLocalGame.
 *
 * It holds no game rules at all. The server owns the state machine and sends a
 * full snapshot; this just renders whatever arrived and forwards intents.
 */
export function useRoom(code: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [error, setError] = useState<SocketError | null>(null);
  const [msLeft, setMsLeft] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setError(null);
      // Socket.IO reconnects on its own after a mobile browser suspends the
      // tab; re-emitting join here is what makes that recovery automatic.
      socket.emit(CLIENT_EVENTS.joinRoom, {
        code,
        playerToken: getRoomTokens(code)?.playerToken,
      });
    });

    socket.on("room_joined", (payload: { code: string; playerToken: string }) => {
      saveRoomTokens(payload.code, { playerToken: payload.playerToken });
    });

    socket.on(SERVER_EVENTS.snapshot, (next: Snapshot) => {
      setSnapshot(next);
      setError(null);
    });

    socket.on(SERVER_EVENTS.stats, (next: GameStats) => setStats(next));

    socket.on(SERVER_EVENTS.error, (next: SocketError) => setError(next));

    socket.on("connect_error", () => {
      setError({ code: "ROOM_GONE", message: "Lost connection to the server." });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code]);

  // Display only — the server's deadline is authoritative.
  //
  // The remaining time is worked out entirely in server terms
  // (deadlineAt - serverNow), then counted down using the local clock only to
  // measure *elapsed* time. The client's absolute clock is never trusted: a PC
  // running 8 seconds behind would otherwise show 18 on a 10-second timer and
  // then get cut off at 10 when the server advanced.
  useEffect(() => {
    if (!snapshot || snapshot.phase !== "question") {
      setMsLeft(0);
      return;
    }
    const remainingAtReceipt = snapshot.deadlineAt - snapshot.serverNow;
    const receivedAt = Date.now();
    const tick = () =>
      setMsLeft(Math.max(0, remainingAtReceipt - (Date.now() - receivedAt)));
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [snapshot]);

  function start() {
    const tokens = getRoomTokens(code);
    if (!tokens?.hostToken) return;
    socketRef.current?.emit(CLIENT_EVENTS.startGame, { code, hostToken: tokens.hostToken });
  }

  function answer(optionIndex: number) {
    const tokens = getRoomTokens(code);
    if (!tokens?.playerToken || !snapshot) return;
    socketRef.current?.emit(CLIENT_EVENTS.submitAnswer, {
      code,
      playerToken: tokens.playerToken,
      questionIndex: snapshot.questionIndex,
      optionIndex,
    });
  }

  function requestStats() {
    socketRef.current?.emit(CLIENT_EVENTS.requestStats, { code });
  }

  return { snapshot, stats, error, msLeft, start, answer, requestStats };
}
