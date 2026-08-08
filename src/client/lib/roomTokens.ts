/**
 * Server-issued tokens, stored per room code.
 *
 * The host token is what stops anyone in the room from starting the game; the
 * player token is what makes reconnect work. Known limitation, accepted: lose
 * the host token (cleared storage, different browser) and that room can never
 * be started. Make a new room.
 */

const KEY = "quizroom.roomTokens";

export interface RoomTokens {
  playerToken: string;
  hostToken?: string;
}

type Store = Record<string, RoomTokens>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export function getRoomTokens(code: string): RoomTokens | undefined {
  return read()[code];
}

export function saveRoomTokens(code: string, tokens: RoomTokens): void {
  try {
    const store = read();
    store[code] = { ...store[code], ...tokens };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private mode. The game still works; reconnect just won't.
  }
}
