import {
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  varchar,
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

export type QuizRow = typeof quizzes.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
