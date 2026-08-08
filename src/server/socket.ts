import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  createRoomSchema,
  joinRoomSchema,
  roomCodeSchema,
  startGameSchema,
  submitAnswerSchema,
  type ErrorCode,
  type GameStats,
  type QuestionStat,
} from "../shared/socket.js";
import {
  applyEvent,
  createRoom,
  getRoom,
  joinRoom,
  playerIdForToken,
  snapshotFor,
  type Room,
} from "./rooms.js";
import { findQuiz } from "./quizStore.js";
import { recordRoomAnswers } from "./statsStore.js";

/**
 * The socket driver. It owns transport and nothing else — every rule lives in
 * the pure reducer, the same one P2 drives from a React hook.
 */

interface SocketData {
  code?: string;
  playerId?: string;
  isHost?: boolean;
}

export function attachSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    // Same origin in production, Vite proxy in dev — no CORS config needed.
    serveClient: false,
  });

  io.on("connection", (socket: Socket) => {
    socket.on(CLIENT_EVENTS.createRoom, (raw: unknown) => {
      void handleCreate(io, socket, raw);
    });
    socket.on(CLIENT_EVENTS.joinRoom, (raw: unknown) => {
      handleJoin(io, socket, raw);
    });
    socket.on(CLIENT_EVENTS.startGame, (raw: unknown) => {
      handleStart(io, socket, raw);
    });
    socket.on(CLIENT_EVENTS.submitAnswer, (raw: unknown) => {
      handleAnswer(io, socket, raw);
    });
    socket.on(CLIENT_EVENTS.requestStats, (raw: unknown) => {
      const payload = parse(z.object({ code: roomCodeSchema }), raw, socket);
      if (!payload) return;
      const room = getRoom(payload.code);
      if (room) socket.emit(SERVER_EVENTS.stats, computeStats(room));
    });
    socket.on("disconnect", () => {
      handleDisconnect(io, socket);
    });
  });

  return io;
}

function fail(socket: Socket, code: ErrorCode, message: string): void {
  socket.emit(SERVER_EVENTS.error, { code, message });
}

/** Zod on every inbound payload — this catches our own client bugs. */
function parse<T>(schema: z.ZodType<T>, raw: unknown, socket: Socket): T | null {
  const result = schema.safeParse(raw);
  if (!result.success) {
    fail(socket, "BAD_PAYLOAD", "That request didn't look right.");
    return null;
  }
  return result.data;
}

/** Everyone in the room gets their own snapshot — `yourAnswer` differs per player. */
function broadcast(io: Server, room: Room): void {
  const stats = room.state.phase === "ended" ? computeStats(room) : null;
  for (const socket of io.sockets.sockets.values()) {
    const data = socket.data as SocketData;
    if (data.code !== room.code || !data.playerId) continue;
    socket.emit(SERVER_EVENTS.snapshot, snapshotFor(room, data.playerId, data.isHost ?? false));
    // Stats ride along with the final snapshot so the podium never shows a
    // spinner where the numbers should be.
    if (stats) socket.emit(SERVER_EVENTS.stats, stats);
  }
}

async function handleCreate(io: Server, socket: Socket, raw: unknown): Promise<void> {
  const payload = parse(createRoomSchema, raw, socket);
  if (!payload) return;

  const quiz = await findQuiz(payload.quizId);
  if (!quiz) {
    fail(socket, "QUIZ_GONE", "That quiz no longer exists.");
    return;
  }

  const room = createRoom(quiz, payload.questionDurationMs);
  // A timer-driven transition has no socket to reply to, so the room tells us.
  room.onAdvance = () => {
    broadcast(io, room);
    if (room.state.phase === "ended") void persistStats(room);
  };

  const join = joinRoom(room, undefined);
  if (!join) {
    fail(socket, "ROOM_GONE", "Could not open that room.");
    return;
  }
  room.hostPlayerId = join.playerId;

  const data = socket.data as SocketData;
  data.code = room.code;
  data.playerId = join.playerId;
  data.isHost = true;
  void socket.join(room.code);

  socket.emit("room_created", {
    code: room.code,
    hostToken: room.hostToken,
    playerToken: join.playerToken,
  });
  broadcast(io, room);
}

function handleJoin(io: Server, socket: Socket, raw: unknown): void {
  const payload = parse(joinRoomSchema, raw, socket);
  if (!payload) return;

  const room = getRoom(payload.code);
  if (!room) {
    // Render restarts on every deploy; in-memory rooms don't survive it.
    fail(socket, "ROOM_GONE", "That room doesn't exist any more.");
    return;
  }

  const join = joinRoom(room, payload.playerToken);
  if (!join) {
    fail(socket, "GAME_STARTED", "That game has already started.");
    return;
  }

  const data = socket.data as SocketData;
  data.code = room.code;
  data.playerId = join.playerId;
  data.isHost = join.playerId === room.hostPlayerId;
  void socket.join(room.code);

  socket.emit("room_joined", { code: room.code, playerToken: join.playerToken });
  broadcast(io, room);
}

function handleStart(io: Server, socket: Socket, raw: unknown): void {
  const payload = parse(startGameSchema, raw, socket);
  if (!payload) return;

  const room = getRoom(payload.code);
  if (!room) {
    fail(socket, "ROOM_GONE", "That room doesn't exist any more.");
    return;
  }
  // Without this check anyone in the room could start the game.
  if (payload.hostToken !== room.hostToken) {
    fail(socket, "NOT_HOST", "Only the host can start.");
    return;
  }

  applyEvent(room, { type: "start", at: Date.now() });
  broadcast(io, room);
}

function handleAnswer(io: Server, socket: Socket, raw: unknown): void {
  const payload = parse(submitAnswerSchema, raw, socket);
  if (!payload) return;

  const room = getRoom(payload.code);
  if (!room) {
    fail(socket, "ROOM_GONE", "That room doesn't exist any more.");
    return;
  }

  const playerId = playerIdForToken(room, payload.playerToken);
  if (!playerId) return;

  // A late answer for the previous question must not score against this one.
  if (payload.questionIndex !== room.state.questionIndex) return;

  const before = room.state.phase;
  applyEvent(room, {
    type: "answer",
    playerId,
    optionIndex: payload.optionIndex,
    at: Date.now(),
  });
  broadcast(io, room);

  if (before !== "ended" && room.state.phase === "ended") void persistStats(room);
}

function handleDisconnect(io: Server, socket: Socket): void {
  const data = socket.data as SocketData;
  if (!data.code || !data.playerId) return;
  const room = getRoom(data.code);
  if (!room) return;

  // Runs everyConnectedPlayerHasAnswered too: the last unanswered player
  // locking their phone must not make the room wait out the whole timer.
  applyEvent(room, { type: "player_disconnected", playerId: data.playerId });
  broadcast(io, room);

  if (room.state.phase === "ended") void persistStats(room);
}

export function computeStats(room: Room): GameStats {
  const questions: QuestionStat[] = room.state.quiz.questions.map((question, index) => {
    const answers = Object.values(room.state.answers[index] ?? {});
    const correctCount = answers.filter((answer) => answer.correct).length;
    return {
      questionIndex: index,
      stem: question.stem,
      correctCount,
      answerCount: answers.length,
      accuracy: answers.length === 0 ? 0 : correctCount / answers.length,
    };
  });

  // Everyone wrong on everything ties across all questions; first wins, and
  // hardest/easiest can legitimately be the same question.
  const answered = questions.filter((question) => question.answerCount > 0);
  const hardest =
    answered.length === 0
      ? null
      : answered.reduce((worst, q) => (q.accuracy < worst.accuracy ? q : worst));
  const easiest =
    answered.length === 0
      ? null
      : answered.reduce((best, q) => (q.accuracy > best.accuracy ? q : best));

  return { questions, hardest, easiest };
}

async function persistStats(room: Room): Promise<void> {
  // Set before the await, so two events landing in the same tick can't both
  // pass the check and write the room twice.
  if (room.statsPersisted) return;
  room.statsPersisted = true;
  try {
    await recordRoomAnswers(room);
  } catch (error) {
    // A stats write must never take a finished game down with it.
    console.error("[stats] failed to persist room", room.code, error);
  }
}
