import { sampleQuiz } from "../src/shared/sample-quiz.js";
import { db, schema } from "../src/server/db/index.js";
import { quizExists } from "../src/server/quizStore.js";
import { eq } from "drizzle-orm";

/**
 * The permanent sample quiz. A visitor plays instantly, and the demo survives a
 * dry LLM key. Its id is fixed ("sample") so the link never changes.
 */
async function main() {
  if (await quizExists(sampleQuiz.id)) {
    console.log(`sample quiz already present (/q/${sampleQuiz.id})`);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.quizzes).values({
      id: sampleQuiz.id,
      title: sampleQuiz.title,
      sourceMode: sampleQuiz.sourceMode,
      createdAt: new Date(sampleQuiz.createdAt),
    });
    await tx.insert(schema.questions).values(
      sampleQuiz.questions.map((question, position) => ({
        id: question.id,
        quizId: sampleQuiz.id,
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

  console.log(`seeded sample quiz at /q/${sampleQuiz.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
