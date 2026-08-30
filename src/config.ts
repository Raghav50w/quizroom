import "dotenv/config";
import { z } from "zod";

/**
 * Env parsed once, fails fast on startup.
 *
 * The env vars *are* the provider abstraction — any OpenAI-compatible endpoint
 * works, so switching from Gemini to Fireworks/Groq/OpenRouter is a config
 * change, not a code change. No provider interface, no adapters.
 *
 * Node-only (reads process.env). Never imported from src/shared or src/client.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  GENERATION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DAILY_GENERATION_LIMIT: z.coerce.number().int().positive().default(100),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example`);
}

export const config = parsed.data;
