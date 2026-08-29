import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Quizzes are immutable once saved: no update routes, no expiry, no deletes.
 * The link is the credential.
 *
 * Rooms, players, and answers arrive in P4 — freezing those tables now would be
 * guessing at a schema the state machine hasn't needed yet.
 */

export const quizzes = pgTable("quizzes", {
  id: varchar("id", { length: 24 }).primaryKey(),
  title: text("title").notNull(),
  sourceMode: varchar("source_mode", { length: 8 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const questions = pgTable(
  "questions",
  {
    id: varchar("id", { length: 24 }).primaryKey(),
    quizId: varchar("quiz_id", { length: 24 })
      .notNull()
      // Free and correct. Nothing is ever deleted today, so it never fires —
      // worth having, not worth talking about.
      .references(() => quizzes.id, { onDelete: "cascade" }),
    /** Presentation order. The client never reorders; this preserves review order. */
    position: smallint("position").notNull(),
    stem: text("stem").notNull(),
    optionA: text("option_a").notNull(),
    optionB: text("option_b").notNull(),
    optionC: text("option_c").notNull(),
    optionD: text("option_d").notNull(),
    correctIndex: smallint("correct_index").notNull(),
    origin: varchar("origin", { length: 6 }).notNull(),
  },
  (table) => [
    // The database refuses an unplayable question even if a bug gets past Zod.
    check("correct_index_range", sql`${table.correctIndex} BETWEEN 0 AND 3`),
    index("questions_quiz_id_position_idx").on(table.quizId, table.position),
  ],
);

/**
 * Rooms and answers exist for post-game stats. A room is written once, when
 * the game ends — nothing needs them mid-game, since live state is in memory.
 */
export const rooms = pgTable(
  "rooms",
  {
    id: varchar("id", { length: 24 }).primaryKey(),
    code: varchar("code", { length: 4 }).notNull(),
    quizId: varchar("quiz_id", { length: 24 })
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    playerCount: smallint("player_count").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rooms_code_idx").on(table.code)],
);

export const answers = pgTable(
  "answers",
  {
    roomId: varchar("room_id", { length: 24 })
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    playerId: varchar("player_id", { length: 24 }).notNull(),
    questionId: varchar("question_id", { length: 24 })
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    optionIndex: smallint("option_index").notNull(),
    correct: boolean("correct").notNull(),
    responseTimeMs: integer("response_time_ms").notNull(),
  },
  (table) => [
    // Friends double-tap. One answer per player per question per room.
    primaryKey({ columns: [table.roomId, table.playerId, table.questionId] }),
    check("option_index_range", sql`${table.optionIndex} BETWEEN 0 AND 3`),
  ],
);

/**
 * PDF chunks and their embeddings, for topic-guided retrieval.
 *
 * `documentId` is a nanoid minted at upload time — there is no `documents`
 * table. One would hold a filename and a page count that nothing would ever
 * read. Retrieval scopes by document, not quiz: chunks exist before a quiz
 * does, since `saveQuiz` only mints the quiz id at save time.
 *
 * No indexes, deliberately. Not the ANN index — IVFFlat on a few hundred rows
 * costs recall and buys nothing — and not a plain one on `documentId` either,
 * because Postgres scans a table this small faster than it can consult an index.
 *
 * The 768 is pinned here *and* in the embedding request. If they ever drift, the
 * failure is a database error after paying to embed the whole document.
 */
export const chunks = pgTable("chunks", {
  id: varchar("id", { length: 24 }).primaryKey(),
  documentId: varchar("document_id", { length: 24 }).notNull(),
  /** Position in the document. Retrieved chunks are re-sorted by this. */
  ordinal: smallint("ordinal").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 768 }).notNull(),
});

export type QuizRow = typeof quizzes.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
export type AnswerRow = typeof answers.$inferSelect;
export type ChunkRow = typeof chunks.$inferSelect;
