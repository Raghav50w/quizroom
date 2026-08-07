import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { quizSchema, type Quiz } from "../shared/quiz.js";
import { db, schema } from "./db/index.js";

/**
 * The only place Quiz JSON meets SQL. Everything else on the server passes the
 * frozen contract around.
 */

/** Saves a reviewed quiz. Called once per quiz, ever — there are no updates. */
export async function saveQuiz(quiz: Quiz): Promise<Quiz> {
  const id = nanoid(10);
  const stored: Quiz = {
    ...quiz,
    id,
    createdAt: new Date().toISOString(),
  };

  // One transaction: a quiz row with no questions is not a thing that should
  // ever be reachable by a link.
  await db.transaction(async (tx) => {
    await tx.insert(schema.quizzes).values({
      id,
      title: stored.title,
      sourceMode: stored.sourceMode,
      createdAt: new Date(stored.createdAt),
    });

    await tx.insert(schema.questions).values(
      stored.questions.map((question, position) => ({
        id: question.id,
        quizId: id,
        position,
        stem: question.stem,
        optionA: question.options[0],
        optionB: question.options[1],
        optionC: question.options[2],
        optionD: question.options[3],
        correctIndex: question.correctIndex,
        origin: question.origin,
      })),
    );
  });

  return stored;
}

export async function findQuiz(id: string): Promise<Quiz | null> {
  const [quiz] = await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, id)).limit(1);
  if (!quiz) return null;

  const rows = await db
    .select()
    .from(schema.questions)
    .where(eq(schema.questions.quizId, id))
    .orderBy(asc(schema.questions.position));

  // Parsed on the way out too: the contract is what callers rely on, and a
  // hand-edited row shouldn't reach a player as a half-valid quiz.
  return quizSchema.parse({
    schemaVersion: 1,
    id: quiz.id,
    title: quiz.title,
    createdAt: quiz.createdAt.toISOString(),
    sourceMode: quiz.sourceMode,
    questions: rows.map((row) => ({
      id: row.id,
      stem: row.stem,
      options: [row.optionA, row.optionB, row.optionC, row.optionD],
      correctIndex: row.correctIndex,
      origin: row.origin,
    })),
  });
}

export async function quizExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.quizzes.id })
    .from(schema.quizzes)
    .where(eq(schema.quizzes.id, id))
    .limit(1);
  return row !== undefined;
}
