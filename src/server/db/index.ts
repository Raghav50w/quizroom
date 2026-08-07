import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../../config.js";
import * as schema from "./schema.js";

/**
 * One pool for the process. Neon sleeps and wakes in about a second, so a
 * connection can fail once after idle — the pool retries on the next query.
 */
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });
export { schema };
