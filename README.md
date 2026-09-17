# QuizRoom

Turn a topic, your notes, or a PDF into a multiple-choice quiz, then play it — solo, or live with friends on their phones.

**Live:** https://quizroom-n4qd.onrender.com · **Try it:** [sample quiz](https://quizroom-n4qd.onrender.com/q/sample)

> Free instance — the first request after ~15 minutes idle takes about 50 seconds to wake.

## How it works

1. **Make** — name a topic, paste notes, or upload a PDF. An LLM writes the questions; a validation gate drops the bad ones.
2. **Review** — fix, reorder, delete, add. One save.
3. **Play** — solo against a timer, or open a room and friends join with a 4-digit code.
4. **Results** — live leaderboard, then a podium with per-question accuracy.

No accounts. A quiz link is the credential.

## Stack

TypeScript · React 19 · Express 5 · Socket.IO · PostgreSQL (Neon) + Drizzle · Zod · any OpenAI-compatible LLM

PDF retrieval is a small Python service (`rag/`): PyMuPDF → chunks → local embeddings (fastembed) → pgvector. It runs in the same container and only Node can reach it.

## Layout

```
src/shared/     quiz schema, game state machine, socket contract
src/generator/  topic | notes | excerpt -> validated quiz JSON
src/server/     Express, Socket.IO, Drizzle
src/client/     React
rag/            Python: PDF -> chunks -> embeddings -> retrieval
scripts/        generate.ts (CLI), seed.ts
```

## Run it

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL, LLM_*
npm run db:push
npm run db:seed
npm run dev:server            # :4000
npm run dev                   # :5173
```

For PDF upload, also run the Python service:

```bash
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r rag/requirements.txt
uvicorn main:app --app-dir rag --port 8000
```

Tests: `npm test` · `cd rag && pytest`

## Deploy

One Docker image, two processes (Node in front, uvicorn on localhost). `docker build -t quizroom .` — see the `Dockerfile`.

## Notes

- Rooms are in-memory; a restart ends live games.
- Quizzes are immutable once saved and public to anyone with the link.
- Generation is rate-limited per IP (5/hour) and capped daily — a fuse, not an abuse control.
