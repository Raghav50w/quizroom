import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { generateQuiz } from "../generator/index.js";
import { quizSchema } from "../shared/quiz.js";
import { callerKey, checkGenerationAllowed, checkLimit, recordGeneration } from "./limits.js";
import { createJob, getJob, runPdfJob } from "./pdf.js";
import { findQuiz, saveQuiz } from "./quizStore.js";

export const api = Router();

const MAX_SOURCE_CHARS = 15_000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The upload is held in memory and handed straight to the RAG service. The
 * size cap is enforced here as well as in the RAG service, so an oversized
 * file is rejected at the edge. The client checks it too, before uploading.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/** Generation costs an LLM call; saving costs database rows. Both are finite. */
const GENERATE_PER_HOUR = 5;
const SAVE_PER_HOUR = 20;

function retryMessage(limit: number, retryAfterSeconds: number): string {
  if (retryAfterSeconds > 60) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return `That's ${limit} in an hour — give it ${minutes} minutes and try again.`;
  }
  return `That's ${limit} in an hour — give it a moment and try again.`;
}

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
    message: retryMessage(limit, result.retryAfterSeconds),
  });
  return true;
}

/** Daily counter and kill switch. Returns true (and responds) when blocked. */
function generationBlocked(res: Response): boolean {
  const limit = checkGenerationAllowed();
  if (limit.allowed) return false;
  res.status(503).json({
    error: limit.reason,
    message:
      limit.reason === "disabled"
        ? "Generation is switched off right now."
        : "Today's generation limit is used up. Try again tomorrow, or enter questions manually.",
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
 * 5-15s, inside any proxy limit. PDFs take longer and use the job route below.
 */
api.post("/generate", async (req: Request, res: Response) => {
  if (overLimit(req, res, "generate", GENERATE_PER_HOUR)) return;

  const parsed = generateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bad_request", message: parsed.error.issues[0]?.message });
    return;
  }

  if (generationBlocked(res)) return;
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
 *
 * Counts against the same daily counter and kill switch as text generation. No
 * separate rate-limit bucket: the daily counter is already the fuse.
 */
api.post("/pdf", upload.single("file"), (req: Request, res: Response) => {
  if (overLimit(req, res, "generate", GENERATE_PER_HOUR)) return;

  if (!req.file) {
    res.status(400).json({ error: "bad_request", message: "No file uploaded." });
    return;
  }

  const count = Number(req.body?.count ?? 10);
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 200) : "";

  if (!VALID_COUNTS.has(count)) {
    res.status(400).json({ error: "bad_request", message: "Invalid question count." });
    return;
  }

  if (generationBlocked(res)) return;
  recordGeneration();
  const jobId = createJob();

  // Deliberately not awaited — the response goes back now and the client polls.
  // runPdfJob owns its own errors and always writes a terminal state, so this
  // floating promise cannot reject and take the process down.
  void runPdfJob(jobId, req.file.buffer, prompt.trim() || null, count, req.file.originalname);

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
