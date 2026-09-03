# QuizRoom

Turn a topic or your own notes into a multiple-choice quiz, then play it — solo, or live with friends on their phones.

**Live demo:** https://quizroom-n4qd.onrender.com
**Play instantly:** [the sample quiz](https://quizroom-n4qd.onrender.com/q/sample) — no sign-up, no account.

> Hosted on a free instance, so the first request after ~15 minutes idle takes about 50 seconds to wake.

---

## What it does

1. **Make a quiz.** Paste your lecture notes, or just name a topic. An LLM writes the questions; a validation gate throws out the bad ones before you ever see them. Or write them yourself.
2. **Review it.** Fix a stem, move the correct answer, delete a dud, add your own. Everything stays in browser state until one save.
3. **Play it.** Solo against a timer, or open a room and let people join from their phones with a 4-digit code.
4. **See how it went.** Live leaderboard between questions, then a podium with per-question accuracy and the hardest and easiest questions.

There are no accounts anywhere. A quiz link is the credential; room membership is a server-issued token in `localStorage`.

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, Node 20+ |
| Frontend | React 19, Vite, Tailwind 4 |
| Backend | Express 5 |
| Realtime | Socket.IO |
| Database | PostgreSQL (Neon) with Drizzle ORM |
| Validation | Zod — one schema shared by CLI, server, and client |
| LLM | Any OpenAI-compatible endpoint (currently Gemini) |
| PDF + retrieval | Python service — PyMuPDF, fastembed, pgvector |

One `package.json`, plain folders, no monorepo tooling. In production one Express process serves the API, the WebSocket, and the React build — one port, no CORS.

PDF retrieval runs as a small Python service alongside it. Both live in a single container and it binds to localhost, so it is still one deploy and one cold start; nothing outside the container can reach it. Python because that is where the PDF and embedding libraries are, and embeddings are computed locally — no API key, no quota, no rate limit.

---

## Architecture

```
src/
  shared/      Quiz schema, the game state machine, the socket contract
  generator/   topic or notes -> validated Quiz JSON. Imports nothing from server/ or client/
  server/      Express, Socket.IO, Drizzle
  client/      React
scripts/
  generate.ts  make a quiz from the terminal
  seed.ts      install the permanent sample quiz
rag/           Python: PDF -> chunks -> embeddings -> retrieval
  pdf.py       PyMuPDF extraction, cleaning, chunking
  embed.py     local embeddings (all-MiniLM-L6-v2, 384 dims)
  store.py     pgvector reads and writes
  selection.py even sampling and ordinal ordering
  main.py      FastAPI: /ingest and /select
```

The Drizzle schema owns every table, `rag/` only owns rows — so `npm run db:push`
remains the one place the database shape is managed.

### The game is a pure function

The rules live in `src/shared/game.ts` as `(state, event) => state` — no I/O, no timers, no randomness, no sockets.

Two different drivers feed it the same events:

- **Solo** (`useLocalGame.ts`) — a React hook holding a `setTimeout`
- **Multiplayer** (`server/socket.ts`) — the server, broadcasting a full snapshot after every transition

Single-player was built first against that reducer, so by the time multiplayer arrived the risky logic had already been exercised for a whole phase. Adding rooms meant writing a new driver, not rewriting the rules. The reducer has 20 tests and never touches the network.

Three details in there are load-bearing:

- **Every transition carries an epoch.** An `advance` arriving with a stale epoch is ignored. Without it, "everyone answered early" and "the deadline fired" both land and the room silently skips a question.
- **Disconnects re-check whether everyone has answered.** Otherwise the last player locking their phone makes the room wait out the full timer — which happens constantly in a real five-phone test.
- **Deadlines are absolute UTC timestamps, never durations.** No clock-offset estimation between server and phones.

### The server never sends the answer early

A room snapshot carries `correctIndex: null` while the question is live, and fills it in at results. Solo mode ships the whole quiz to the browser — you can only cheat yourself — but in a room that would put the answer in the network tab.

### Generation is gated, not trusted

`src/generator/` asks for N+2 questions and keeps the first N that survive:

- exactly four options, exactly one correct
- no duplicate options (case- and whitespace-insensitive)
- no "all of the above"
- the stem must not contain the correct answer's wording
- the longest option can't be more than 2.5× the shortest — the real tell that a model gave the answer away by writing it in more detail
- near-duplicate stems removed by Jaccard overlap on token sets

Bad questions are **dropped, not thrown** — one malformed question shouldn't cost you the other nine. The model's JSON is also unwrapped from markdown fences and leading prose before parsing, and a plaintext refusal simply fails and retries once.

### Database work that does real work

- `UNIQUE(room_id, player_id, question_id)` as a composite primary key — friends double-tap
- `CHECK (correct_index BETWEEN 0 AND 3)` — the database refuses an unplayable question even if a bug gets past Zod
- Saving a quiz and recording a finished room are each one transaction
- Per-question accuracy groups by question **and room** in an inner CTE, so two rooms playing the same quiz stay distinguishable instead of blending into one number
- Final placement uses `RANK() OVER (ORDER BY score DESC, total_response_time ASC)`, implementing the tiebreak in SQL

Live play touches the database exactly **zero** times. Room state is in memory; a finished room is written once at the end.

---

## Running it

```bash
npm install
cp .env.example .env     # then fill in the values
npm run db:push
npm run db:seed
```

Two terminals:

```bash
npm run dev:server       # Express + Socket.IO on :4000
```

```bash
npm run dev              # Vite on :5173, proxying to :4000
```

### Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `LLM_BASE_URL` | any OpenAI-compatible endpoint |
| `LLM_API_KEY` | server-side only — never prefix an LLM key with `VITE_`, Vite inlines those into the browser bundle |
| `LLM_MODEL` | e.g. `gemini-3.6-flash` |
| `GENERATION_ENABLED` | kill switch, no redeploy needed |
| `DAILY_GENERATION_LIMIT` | a fuse against a misbehaving retry loop |

Env parsing is a Zod schema that fails fast on startup, so a missing variable is a clear error rather than a mystery crash later.

### The CLI

The generator runs standalone, with no server and no database:

```bash
npx tsx scripts/generate.ts --topic "the French Revolution" --count 10 > quiz.json
```

Only the payload goes to stdout — progress and warnings go to stderr, so that redirect produces a file that parses.

### Tests

```bash
npm test
```

71 tests, concentrated where the risk actually is: the room state machine under fake timers (epoch guards, early advance, disconnect-triggered recheck), the generation gate fed hand-written bad model responses, ranking tiebreaks, and the LLM client's retry and timeout behaviour.

---

## Deliberate limitations

Written down so they're decisions rather than surprises:

- **Rooms are in-memory and don't survive a restart.** A reconnecting client gets `ROOM_GONE` and is told to ask for a new room. Redis would be more moving parts than the entire app.
- **Lose the host token and that room can never be started.** Clearing storage, switching device, opening the link in another browser — all unrecoverable. Make a new room.
- **Quizzes are immutable once saved.** No edit routes, no delete, no expiry. Review is the only chance to change anything.
- **"Your quizzes" lives in `localStorage`,** so it's per-browser. The quizzes themselves are permanent and public to anyone with the link.
- **Solo runs are ephemeral** — no scores are recorded, so per-quiz play counts don't exist.
- **No rate limiting, no CAPTCHA, no abuse controls.** This is a portfolio project for a handful of players; the daily generation counter exists to stop a runaway retry loop, not an adversary.
