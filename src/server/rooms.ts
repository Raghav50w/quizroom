import { nanoid } from "nanoid";
import {
  createGame,
  reduce,
  type GameEvent,
  type GameState,
} from "../shared/game.js";
import type { Quiz } from "../shared/quiz.js";
import type { Snapshot } from "../shared/socket.js";

/**
 * In-memory room registry. Rooms do not survive a restart — Render redeploys
 * kill live rooms, and reconnecting clients get ROOM_GONE. Accepted: this is a
 * demo for ~10 people, and Redis would be more moving parts than the whole app.
 */

export interface Room {
  code: string;
  quiz: Quiz;
  hostToken: string;
  hostPlayerId: string;
  /** playerId -> token. Server-issued, so one browser can't join N times. */
  tokens: Map<string, string>;
  takenNicknames: Set<string>;
  state: GameState;
  /** Cleared on early advance so it can't fire for a question we already left. */
  timer: NodeJS.Timeout | null;
  createdAt: number;
  /** Set by the socket layer so a timer-driven transition still broadcasts. */
  onAdvance?: () => void;
  /**
   * A finished game is written exactly once. Without this, every socket that
   * disconnects after the end writes the room again, and the duplicate rows
   * silently multiply every accuracy number.
   */
  statsPersisted?: boolean;
}

const rooms = new Map<string, Room>();

const ADJECTIVES = [
  "Brave", "Swift", "Clever", "Sunny", "Lucky", "Bold", "Quiet", "Merry",
  "Nimble", "Bright", "Keen", "Jolly", "Wise", "Calm", "Eager", "Fleet",
];
const ANIMALS = [
  "Otter", "Falcon", "Badger", "Heron", "Lynx", "Marten", "Osprey", "Puffin",
  "Raven", "Stoat", "Vole", "Wren", "Ibex", "Kite", "Newt", "Shrew",
];

/** 4-digit numeric so a phone shows the number pad. Collision-checked. */
function generateCode(): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}

/**
 * Server-issued and tracked per room, so two BraveOtters can't appear
 * mid-demo. Falls back to a numbered name once the pairs run out.
 */
function allocateNickname(room: Room): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
    const nickname = `${adjective}${animal}`;
    if (!room.takenNicknames.has(nickname)) {
      room.takenNicknames.add(nickname);
      return nickname;
    }
  }
  const fallback = `Player${room.takenNicknames.size + 1}`;
  room.takenNicknames.add(fallback);
  return fallback;
}

export function createRoom(quiz: Quiz, questionDurationMs: number): Room {
  const code = generateCode();
  const room: Room = {
    code,
    quiz,
    hostToken: nanoid(21),
    hostPlayerId: "",
    tokens: new Map(),
    takenNicknames: new Set(),
    state: createGame(quiz, { questionDurationMs }),
    timer: null,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export interface JoinResult {
  playerId: string;
  playerToken: string;
  reconnected: boolean;
}

/**
 * Join, or rejoin with an existing token. Late join is refused by the reducer
 * (it ignores player_joined outside the lobby), so a rejoining player keeps
 * their score while a newcomer mid-game is turned away by the caller.
 */
export function joinRoom(room: Room, playerToken?: string): JoinResult | null {
  if (playerToken) {
    for (const [playerId, token] of room.tokens) {
      if (token === playerToken) {
        room.state = reduce(room.state, { type: "player_reconnected", playerId });
        return { playerId, playerToken, reconnected: true };
      }
    }
  }

  if (room.state.phase !== "lobby") return null;

  const playerId = nanoid(10);
  const token = nanoid(21);
  const nickname = allocateNickname(room);
  room.tokens.set(playerId, token);
  room.state = reduce(room.state, { type: "player_joined", playerId, nickname });
  return { playerId, playerToken: token, reconnected: false };
}

export function playerIdForToken(room: Room, token: string): string | undefined {
  for (const [playerId, stored] of room.tokens) {
    if (stored === token) return playerId;
  }
  return undefined;
}

/** Every state change goes through here so the deadline timer stays in sync. */
export function applyEvent(room: Room, event: GameEvent): void {
  const before = room.state;
  room.state = reduce(room.state, event);
  if (room.state !== before) syncTimer(room);
}

/**
 * The timer half of the epoch guard. Clearing on every transition stops a
 * timeout from a question we already left, and the reducer's epoch check
 * catches anything that slips through anyway.
 */
function syncTimer(room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  if (room.state.phase !== "question" && room.state.phase !== "results") return;

  const epoch = room.state.epoch;
  const delay = Math.max(0, room.state.deadlineAt - Date.now());
  room.timer = setTimeout(() => {
    applyEvent(room, { type: "advance", epoch, at: Date.now() });
    room.onAdvance?.();
  }, delay);
}

export function closeRoom(room: Room): void {
  if (room.timer) clearTimeout(room.timer);
  rooms.delete(room.code);
}

/** Snapshot for one player. correctIndex stays hidden while the question runs. */
export function snapshotFor(room: Room, playerId: string, isHost: boolean): Snapshot {
  const { state } = room;
  const question = state.quiz.questions[state.questionIndex];
  const revealing = state.phase === "results" || state.phase === "ended";

  return {
    code: room.code,
    quizTitle: state.quiz.title,
    phase: state.phase,
    questionIndex: state.questionIndex,
    totalQuestions: state.quiz.questions.length,
    deadlineAt: state.deadlineAt,
    questionDurationMs: state.questionDurationMs,
    question:
      question && state.phase !== "lobby"
        ? { stem: question.stem, options: question.options }
        : null,
    correctIndex: revealing && question ? question.correctIndex : null,
    players: Object.values(state.players).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      connected: player.connected,
    })),
    yourId: playerId,
    yourAnswer: state.answers[state.questionIndex]?.[playerId]?.optionIndex ?? null,
    isHost,
  };
}

/** Test seam only — rooms are process-local and never enumerated in the app. */
export function _resetRooms(): void {
  for (const room of rooms.values()) if (room.timer) clearTimeout(room.timer);
  rooms.clear();
}

export function _roomCount(): number {
  return rooms.size;
}
