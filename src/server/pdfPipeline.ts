import { unlink } from "node:fs/promises";
import { generateQuiz } from "../generator/index.js";
import { failJob, finishJob, setStep, type JobError } from "./jobs.js";
import { RagError, ingestPdf, selectSource } from "./ragClient.js";

/**
 * The whole PDF job, run detached from the request that started it.
 *
 * Everything is inside one try/catch that always writes a terminal state. A
 * rejection escaping a floating promise is an unhandled rejection — on a free
 * instance that reads as the site randomly 404ing, the same failure the pool
 * error handler in db/index.ts already guards against.
 *
 * The temp file is unlinked in a `finally`: multer wrote it to disk, and it is
 * ours to remove whichever way the job ends.
 */
export async function runPdfJob(
  jobId: string,
  filePath: string,
  prompt: string | null,
  count: number,
  filename: string,
): Promise<void> {
  try {
    // One call covers extraction, chunking and embedding — see JobStep.
    setStep(jobId, "reading");
    const { documentId } = await ingestPdf(filePath);
    const source = await selectSource(documentId, prompt);

    setStep(jobId, "generating");
    const { quiz, shortfall } = await generateQuiz({
      source,
      count,
      sourceMode: "pdf",
      // A retrieved excerpt starts mid-sentence, so the generator's
      // derive-from-first-line fallback would produce a title like "ng losses.
      // In contrast,". The focus is what the user meant; with none, Review
      // requires them to name it before saving anyway.
      title: prompt?.trim() || titleFromFilename(filename),
      ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
      log: (message) => console.warn(`[pdf ${jobId}] ${message}`),
    });

    finishJob(jobId, quiz, shortfall);
  } catch (error) {
    console.error(`[pdf ${jobId}] failed:`, error);
    failJob(jobId, toJobError(error));
  } finally {
    await unlink(filePath).catch(() => {
      // Already gone, or never written. Not worth failing a finished job over.
    });
  }
}

/** "Intro_to_Cell-Biology.pdf" -> "Intro to Cell Biology". */
function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return stem.slice(0, 120) || "Untitled quiz";
}

/**
 * The service's codes are the client's codes, except `unknown_document` and
 * `unavailable` — both mean the pipeline broke rather than the file being bad,
 * and the user can do nothing with that distinction.
 */
function toJobError(error: unknown): JobError {
  if (error instanceof RagError) {
    if (
      error.code === "no_text_found" ||
      error.code === "file_too_large" ||
      error.code === "too_many_pages"
    ) {
      return error.code;
    }
  }
  return "generation_failed";
}
