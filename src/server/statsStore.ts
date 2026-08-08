import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "./db/index.js";
import type { Room } from "./rooms.js";

/**
 * Written once, when a game ends. Live play never touches the database — the
 * room state machine is entirely in memory, which is what keeps the game loop
 * fast and the failure modes few.
 */
export async function recordRoomAnswers(room: Room): Promise<void> {
  const roomId = nanoid(12);
  const { state } = room;

  const rows = Object.entries(state.answers).flatMap(([indexKey, byPlayer]) => {
    const question = state.quiz.questions[Number(indexKey)];
    if (!question) return [];
    return Object.entries(byPlayer).map(([playerId, answer]) => ({
      roomId,
      playerId,
      questionId: question.id,
      nickname: state.players[playerId]?.nickname ?? "unknown",
      optionIndex: answer.optionIndex,
      correct: answer.correct,
      responseTimeMs: answer.responseTimeMs,
    }));
  });

  // One transaction: a room row with no answers would quietly skew every
  // later query that joins them.
  await db.transaction(async (tx) => {
    await tx.insert(schema.rooms).values({
      id: roomId,
      code: room.code,
      quizId: state.quiz.id,
      playerCount: Object.keys(state.players).length,
    });
    if (rows.length > 0) await tx.insert(schema.answers).values(rows);
  });
}

export interface QuizAccuracyRow {
  questionId: string;
  stem: string;
  answerCount: number;
  correctCount: number;
  accuracy: number;
}

/**
 * Per-question accuracy across every room that played this quiz.
 *
 * Grouped by question and room in the inner query, so two rooms playing the
 * same quiz stay distinguishable rather than blending into one number.
 */
export async function quizAccuracy(quizId: string): Promise<QuizAccuracyRow[]> {
  const result = await db.execute<{
    question_id: string;
    stem: string;
    answer_count: string;
    correct_count: string;
  }>(sql`
    WITH per_room AS (
      SELECT a.question_id,
             a.room_id,
             COUNT(*) AS answer_count,
             COUNT(*) FILTER (WHERE a.correct) AS correct_count
      FROM answers a
      JOIN rooms r ON r.id = a.room_id
      WHERE r.quiz_id = ${quizId}
      GROUP BY a.question_id, a.room_id
    )
    SELECT q.id AS question_id,
           q.stem,
           COALESCE(SUM(per_room.answer_count), 0) AS answer_count,
           COALESCE(SUM(per_room.correct_count), 0) AS correct_count
    FROM questions q
    LEFT JOIN per_room ON per_room.question_id = q.id
    WHERE q.quiz_id = ${quizId}
    GROUP BY q.id, q.stem, q.position
    ORDER BY q.position
  `);

  return result.rows.map((row) => {
    const answerCount = Number(row.answer_count);
    const correctCount = Number(row.correct_count);
    return {
      questionId: row.question_id,
      stem: row.stem,
      answerCount,
      correctCount,
      accuracy: answerCount === 0 ? 0 : correctCount / answerCount,
    };
  });
}

export interface RankingRow {
  nickname: string;
  score: number;
  totalResponseTimeMs: number;
  rank: number;
}

/**
 * Final placement for one room, with the tiebreak implemented in SQL:
 * score desc, then total response time asc.
 */
export async function roomRankings(roomId: string): Promise<RankingRow[]> {
  const result = await db.execute<{
    nickname: string;
    score: string;
    total_response_time: string;
    rank: string;
  }>(sql`
    SELECT nickname,
           COUNT(*) FILTER (WHERE correct) AS score,
           SUM(response_time_ms) AS total_response_time,
           RANK() OVER (
             ORDER BY COUNT(*) FILTER (WHERE correct) DESC,
                      SUM(response_time_ms) ASC
           ) AS rank
    FROM answers
    WHERE room_id = ${roomId}
    GROUP BY player_id, nickname
    ORDER BY rank
  `);

  return result.rows.map((row) => ({
    nickname: row.nickname,
    score: Number(row.score),
    totalResponseTimeMs: Number(row.total_response_time),
    rank: Number(row.rank),
  }));
}

/** Most recent rooms for a quiz — the entry point for a stats screen. */
export async function recentRooms(quizId: string, limit = 10) {
  return db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.quizId, quizId))
    .orderBy(desc(schema.rooms.endedAt))
    .limit(limit);
}
