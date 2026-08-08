import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { api } from "./routes.js";
import { attachSockets } from "./socket.js";

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

// Last resort: turn an unhandled route error into a 500 instead of a silent
// hang. Must come after every route, and must take four arguments.
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] unhandled route error:", error);
  if (!res.headersSent) res.status(500).json({ error: "server_error" });
});

// A rejected promise nobody awaited shouldn't take the process down with it —
// on a free instance that reads as the whole site randomly 404ing.
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason);
});

const server = createServer(app);

// Same server, same port: the API, the React build, and the WebSocket.
attachSockets(server);

server.listen(config.PORT, () => {
  console.log(`listening on http://localhost:${config.PORT}`);
});
