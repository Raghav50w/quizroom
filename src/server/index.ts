import express from "express";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { api } from "./routes.js";

/**
 * One process in production: Express serves the React build, the API, and
 * (from P4) the WebSocket. One port, one deploy, no CORS.
 *
 * In dev, Vite runs separately and proxies /api here.
 */
const app = express();

app.use(express.json({ limit: "256kb" }));

// Keeps the Render box awake while someone has the create form open.
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", api);

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, "../../dist/client");

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Client-side routes (/q/:id, /create) must return the SPA, not a 404.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, "index.html"));
  });
}

app.listen(config.PORT, () => {
  console.log(`listening on http://localhost:${config.PORT}`);
});
