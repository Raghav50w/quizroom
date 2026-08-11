import { z } from "zod";
import type { Phase } from "./game.js";

/**
 * The socket contract. Defined here in P4, as planned — freezing it earlier
 * would have been guessing.
 *
 * Inbound payloads are Zod-validated on the server. That catches our own client
 * bugs, not attackers; a malformed payload should produce a clear error rather
 * than a crashed room.
 */

/**
 * Shared so the lobby can show "3 of 8" rather than only finding out when a
 * ninth person is turned away. The server is still the one that enforces it.
 */
export const MAX_PLAYERS = 8;

export const roomCodeSchema = z
  .string()
  // People type "08241", " 8241 ", or with letters mixed in.
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().length(4));

export const createRoomSchema = z.object({
  quizId: z.string().min(1).max(24),
  questionDurationMs: z.union([z.literal(10_000), z.literal(20_000), z.literal(30_000)]),
});

export const joinRoomSchema = z.object({
  code: roomCodeSchema,
  /** Present when reconnecting: proves which player this browser is. */
  playerToken: z.string().min(1).max(64).optional(),
});

export const startGameSchema = z.object({
  code: roomCodeSchema,
  hostToken: z.string().min(1).max(64),
});

export const submitAnswerSchema = z.object({
  code: roomCodeSchema,
  playerToken: z.string().min(1).max(64),
  questionIndex: z.number().int().min(0).max(19),
  optionIndex: z.number().int().min(0).max(3),
});

export type CreateRoomPayload = z.infer<typeof createRoomSchema>;
export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;
export type StartGamePayload = z.infer<typeof startGameSchema>;
export type SubmitAnswerPayload = z.infer<typeof submitAnswerSchema>;

export type ErrorCode =
  | "ROOM_GONE"
  | "GAME_STARTED"
  | "NOT_HOST"
  | "BAD_PAYLOAD"
  | "QUIZ_GONE"
  | "ROOM_FULL";

export interface SocketError {
  code: ErrorCode;
  message: string;
}

export interface PlayerView {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
}

export interface QuestionView {
  stem: string;
  options: [string, string, string, string];
}

/**
 * Full state, never deltas. Mobile Safari suspends sockets on backgrounding, so
 * reconnect is routine — sending everything makes it naturally idempotent.
 *
 * `correctIndex` is null while the question is live. Sending it early would put
 * the answer in the browser's network tab.
 */
export interface Snapshot {
  code: string;
  quizTitle: string;
  phase: Phase;
  questionIndex: number;
  totalQuestions: number;
  deadlineAt: number;
  /**
   * The server's clock at the moment this snapshot was built.
   *
   * Clients must derive the countdown from (deadlineAt - serverNow) and then
   * measure elapsed time locally. Subtracting the client's own Date.now() from
   * deadlineAt shows the wrong number on any machine whose clock has drifted —
   * an 8-second skew makes a 10-second timer read as 18.
   */
  serverNow: number;
  questionDurationMs: number;
  question: QuestionView | null;
  correctIndex: number | null;
  players: PlayerView[];
  yourId: string;
  yourAnswer: number | null;
  isHost: boolean;
}

export interface QuestionStat {
  questionIndex: number;
  stem: string;
  correctCount: number;
  answerCount: number;
  accuracy: number;
}

export interface GameStats {
  questions: QuestionStat[];
  hardest: QuestionStat | null;
  easiest: QuestionStat | null;
}

/** Server -> client event names. */
export const SERVER_EVENTS = {
  snapshot: "snapshot",
  error: "room_error",
  stats: "stats",
} as const;

/** Client -> server event names. */
export const CLIENT_EVENTS = {
  createRoom: "create_room",
  joinRoom: "join_room",
  startGame: "start_game",
  submitAnswer: "submit_answer",
  requestStats: "request_stats",
} as const;
