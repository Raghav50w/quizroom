import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `drizzle-kit push` only — no migration files. One developer, one database,
// and a generated migration history nobody reads is pure overhead here.
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
