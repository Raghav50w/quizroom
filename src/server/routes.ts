import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { generateQuiz } from "../generator/index.js";
import { quizSchema } from "../shared/quiz.js";
import { checkGenerationAllowed, recordGeneration } from "./generationLimit.js";
import { findQuiz, saveQuiz } from "./quizStore.js";

export const api = Router();

const MAX_SOURCE_CHARS = 15_000;

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

/** The reviewed quiz. Server assigns the id, so the client can't pick one. */
const saveBody = quizSchema.omit({ id: true, createdAt: true, schemaVersion: true });

api.post("/quizzes", async (req: Request, res: Response) => {
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
