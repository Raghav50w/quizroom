import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../../config.js";
import * as schema from "./schema.js";

/**
 * One pool for the process. Neon scales to zero and closes idle connections,
 * so a pooled client dying while nothing is using it is routine here.
 */
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
  // Drop our own idle connections before Neon drops them for us. Closing them
  // cleanly on our side is quieter than discovering it on the next query.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

/**
 * Load-bearing. `Pool` emits 'error' for a client that dies while idle, and an
 * unhandled 'error' event is an uncaught exception — it takes the whole
 * process down, which on Render looks like the app randomly 404ing.
 * The pool discards the dead client on its own; this just keeps us alive.
 */
pool.on("error", (error) => {
  console.error("[db] idle client error:", error.message);
});

export const db = drizzle(pool, { schema });
export { schema };
