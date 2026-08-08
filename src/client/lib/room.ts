import { io, type Socket } from "socket.io-client";
import { CLIENT_EVENTS } from "../../shared/socket.js";
import { saveRoomTokens } from "./roomTokens.js";

/**
 * Opening a room is a one-shot handshake, so it gets its own short-lived
 * socket. The room page then connects properly and rejoins with the token.
 */
export function openRoom(quizId: string, questionDurationMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket: Socket = io({ transports: ["websocket", "polling"] });

    const cleanup = () => {
      clearTimeout(timeout);
      socket.disconnect();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The server didn't respond. Try again."));
    }, 15_000);

    socket.on("room_created", (payload: { code: string; hostToken: string; playerToken: string }) => {
      saveRoomTokens(payload.code, {
        playerToken: payload.playerToken,
        hostToken: payload.hostToken,
      });
      cleanup();
      resolve(payload.code);
    });

    socket.on("room_error", (error: { message: string }) => {
      cleanup();
      reject(new Error(error.message));
    });

    socket.on("connect_error", () => {
      cleanup();
      reject(new Error("Could not reach the server."));
    });

    socket.on("connect", () => {
      socket.emit(CLIENT_EVENTS.createRoom, { quizId, questionDurationMs });
    });
  });
}
