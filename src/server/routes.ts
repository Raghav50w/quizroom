import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { tmpdir } from "node:os";
import { z } from "zod";
import { generateQuiz } from "../generator/index.js";
import { quizSchema } from "../shared/quiz.js";
import { checkGenerationAllowed, recordGeneration } from "./generationLimit.js";
import { createJob, getJob } from "./jobs.js";
import { runPdfJob } from "./pdfPipeline.js";
import { callerKey, checkLimit } from "./rateLimit.js";
import { findQuiz, saveQuiz } from "./quizStore.js";

export const api = Router();

const MAX_SOURCE_CHARS = 15_000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * `dest` streams the upload to a temp file instead of holding it in memory.
 * The pipeline unlinks it in a `finally`.
 *
 * The size cap is enforced here as well as in the RAG service: rejecting at the
 * edge means an oversized file is never written to disk at all.
 */
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/**
 * multer throws on an oversized file, and an unhandled throw here reaches the
 * app's last-resort handler as a bare 500 — so the client shows "something went
 * wrong" for the one failure it has specific copy for. Translate it in place.
 */
function uploadOne(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const tooBig = error.code === "LIMIT_FILE_SIZE";
      res.status(tooBig ? 413 : 400).json({
        error: tooBig ? "file_too_large" : "bad_request",
        message: tooBig
          ? "That file is too large — the limit is 10MB."
          : "That upload could not be read.",
      });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
}

/** Generation costs an LLM call; saving costs database rows. Both are finite. */
const GENERATE_PER_HOUR = 5;
const SAVE_PER_HOUR = 20;

function overLimit(
  req: Request,
  res: Response,
  bucket: string,
  limit: number,
): boolean {
  const result = checkLimit(bucket, callerKey(req), limit, HOUR_MS);
  if (result.allowed) return false;
  res.status(429).json({
    error: "rate_limited",
    message: `That's ${limit} in an hour — give it ${result.retryAfterSeconds > 60 ? `${Math.ceil(result.retryAfterSeconds / 60)} minutes` : "a moment"} and try again.`,
  });
  return true;
}

const generateBody = z.object({
  source: z.string().trim().min(1).max(MAX_SOURCE_CHARS),
  count: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
});

/**
 * Generate, but do not save. The result goes back to React state for review;
 * nothing is written until the user posts the reviewed quiz.
 *
 * The request is held open with a spinner on the client — text generation runs
 * 5-15s, inside any proxy limit. The job/ticket system waits for P5, where
 * 60-second PDFs actually need it.
 */
api.post("/generate", async (req: Request, res: Response) => {
  if (overLimit(req, res, "generate", GENERATE_PER_HOUR)) return;

  const parsed = generateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: parsed.error.issues[0]?.message });
    return;
  }

  const limit = checkGenerationAllowed();
  if (!limit.allowed) {
    res.status(503).json({
      error: limit.reason,
      message:
        limit.reason === "disabled"
          ? "Generation is switched off right now."
          : "Today's generation limit is used up. Try again tomorrow, or enter questions manually.",
    });
    return;
  }

  recordGeneration();

  try {
    const { quiz, shortfall } = await generateQuiz({
      source: parsed.data.source,
      count: parsed.data.count,
      sourceMode: "text",
      log: (message) => console.warn(`[generate] ${message}`),
    });
    res.json({ quiz, shortfall: shortfall ?? null });
  } catch (error) {
    console.error("[generate] failed", error);
    res.status(502).json({
      error: "generation_failed",
      message: "The model didn't return a usable quiz. Try again, or enter questions manually.",
    });
  }
});

const VALID_COUNTS = new Set([5, 10, 15, 20]);

/**
 * Upload a PDF. Returns a job id immediately.
 *
 * A PDF runs 10-60 seconds — reading it in the RAG service, then generation —
 * which is longer than a held-open request reliably survives behind a proxy.
 * This is the job system P3 deferred.
 *
 * Counts against the same daily counter and kill switch as text generation. No
 * separate rate-limit bucket: the daily counter is already the fuse, and a
 * second one guards against an attacker who doesn't exist at this scale.
 */
api.post("/pdf", uploadOne, (req: Request, res: Response) => {
  if (overLimit(req, res, "generate", GENERATE_PER_HOUR)) return;

  if (!req.file) {
    res.status(400).json({ error: "bad_request", message: "No file uploaded." });
    return;
  }

  const count = Number(req.body?.count ?? 10);
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 200) : "";

  if (!VALID_COUNTS.has(count)) {
    void unlinkQuietly(req.file.path);
    res.status(400).json({ error: "bad_request", message: "Invalid question count." });
    return;
  }

  const limit = checkGenerationAllowed();
  if (!limit.allowed) {
    void unlinkQuietly(req.file.path);
    res.status(503).json({
      error: limit.reason,
      message:
        limit.reason === "disabled"
          ? "Generation is switched off right now."
          : "Today's generation limit is used up. Try again tomorrow, or enter questions manually.",
    });
    return;
  }

  recordGeneration();
  const jobId = createJob();

  // Deliberately not awaited — the response goes back now and the client polls.
  // runPdfJob owns its own errors and always writes a terminal state, so this
  // floating promise cannot reject and take the process down.
  void runPdfJob(jobId, req.file.path, prompt.trim() || null, count, req.file.originalname);

  res.status(202).json({ jobId });
});

/** Job status. An unknown id is a plain 404; the client shows its generic error. */
api.get("/pdf/:jobId", (req: Request, res: Response) => {
  const job = getJob(String(req.params.jobId ?? ""));
  if (!job) {
    res.status(404).json({ error: "not_found", message: "No job with that id." });
    return;
  }

  res.json({
    step: job.step,
    quiz: job.result ?? null,
    shortfall: job.shortfall ?? null,
    error: job.error ?? null,
  });
});

async function unlinkQuietly(path: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  await unlink(path).catch(() => {});
}

/** The reviewed quiz. Server assigns the id, so the client can't pick one. */
const saveBody = quizSchema.omit({ id: true, createdAt: true, schemaVersion: true });

api.post("/quizzes", async (req: Request, res: Response) => {
  // The one that costs nothing to abuse: no API key needed, just database rows.
  if (overLimit(req, res, "save", SAVE_PER_HOUR)) return;

  const parsed = saveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: parsed.error.issues[0]?.message });
    return;
  }

  try {
    const quiz = await saveQuiz({
      ...parsed.data,
      schemaVersion: 1,
      id: "pending",
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ quiz });
  } catch (error) {
    console.error("[save] failed", error);
    res.status(500).json({ error: "save_failed", message: "Could not save the quiz." });
  }
});

api.get("/quizzes/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  const quiz = await findQuiz(id);
  if (!quiz) {
    res.status(404).json({ error: "not_found", message: "No quiz with that link." });
    return;
  }
  res.json({ quiz });
});
