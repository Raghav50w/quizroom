import { z } from "zod";

/**
 * The Quiz contract. Frozen in P0.
 *
 * Consumed by three things — the generator CLI, the Express server, and the
 * React client — so it lives here and imports nothing Node-only (Vite bundles
 * this folder to the browser).
 *
 * The length caps are load-bearing: a stem plus all four options must fit one
 * phone screen without scrolling. Scrolling to reach option 4 while a 20-second
 * timer runs means the player loses to the layout, not the question.
 */

export const questionSchema = z
  .object({
    id: z.string().min(1),
    stem: z.string().min(10).max(200),
    options: z.tuple([
      z.string().min(1).max(80),
      z.string().min(1).max(80),
      z.string().min(1).max(80),
      z.string().min(1).max(80),
    ]),
    correctIndex: z.number().int().min(0).max(3),
    origin: z.enum(["ai", "manual"]),
  })
  .superRefine((question, ctx) => {
    // The tuple type can't express "all four differ". Compare case- and
    // whitespace-insensitively: "Paris" and "paris " are the same defect.
    const normalised = question.options.map((option) => option.trim().toLowerCase());
    if (new Set(normalised).size !== normalised.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Options must be distinct",
      });
    }
  });

export const quizSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  sourceMode: z.enum(["manual", "text", "pdf"]),
  questions: z.array(questionSchema).min(1).max(20),
});

export type Question = z.infer<typeof questionSchema>;
export type Quiz = z.infer<typeof quizSchema>;
