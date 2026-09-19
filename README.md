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
rag/            Python: PDF -> chunks -> embeddings -> retrieval, plus eval.py
scripts/        seed.ts, eval.ts
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

Tests: `npm test` · Retrieval eval: `python rag/eval.py pdf/` (add `--sweep` for chunk sizes 1000/2000/3000) · Generation eval: `npm run eval`

## Measured

### Retrieval

4 PDFs of different layouts, 70 hand-labelled queries, top-4 chunks — `python rag/eval.py pdf/`. Each label is a query a user might type plus a phrase found only in the passage that answers it; a hit means that passage came back. Cosine search is what ships; BM25 over the same chunks is the standard lexical baseline; even-sample is the no-topic path.

| Method | Hit@4 | MRR | nDCG@4 | P@4 |
|---|---|---|---|---|
| Cosine (MiniLM-L6, pgvector) | 60/70 (86%) | 0.70 | 0.62 | 0.25 |
| BM25 | **68/70 (97%)** | **0.80** | **0.79** | **0.32** |
| Even sample (no search) | 28/70 (40%) | 0.23 | 0.23 | 0.10 |

| Document | Chunks | Queries | Cosine | BM25 | Even |
|---|---|---|---|---|---|
| IEEE paper, two-column, 30 pp | 47 | 16 | 100% (MRR 0.97) | 100% (MRR 0.84) | 19% |
| Textbook chapter (OS, processes), 45 pp | 43 | 24 | 79% | 92% | 12% |
| Lecture slides, same chapter, 45 pp | 5 | 14 | 93% | 100% | 86% |
| Single-column report, 8 pp | 6 | 16 | 75% | 100% | 62% |

What it says: on the two long documents, searching beats not searching by 60-80 points. Between the two searches, BM25 wins — cosine's eight misses are queries whose answer is an exact token (`11.8%`, `task_struct`, `kra_not_checked`) that a 384-dimension embedding blurs and a lexical index does not. Cosine ranks the right chunk first more often only on the paper (MRR 0.97 vs 0.84). Cosine stays because it also answers a query phrased in different words from the text; BM25 stays in the eval as the bar to clear. On a 5-chunk document top-4 is nearly the whole document, which is why even sampling scores 86% there and 12% on the textbook.

Labels are in `rag/evals/queries.py`. The PDFs are not committed (they are not ours to republish); the paper is *State-of-the-Art Power Electronics in AI Data Centers* (IEEE OJPEL 2026), the chapter and slides are Silberschatz *Operating System Concepts* ch. 3, the report is the author's own.

Ingest embeds at 39 chunks/s locally, peaking at 239 MB RSS in batches of 8. Cosine search, including embedding the query and the round trip to Neon: p50 232 ms, p95 584 ms.

### Generation

8 sources (topics + pasted notes), 12 questions asked each — `npm run eval`:

| | |
|---|---|
| Raw questions returned | 96 |
| Rejected by the validation gate | 0 |
| Near-duplicates removed | 0 |
| Correct-answer position before shuffle | A 24% · B 30% · C 27% · D 19% |

PDF to quiz, judged — `npm run eval -- --pdf-only --pdf chapter.pdf --about "process scheduling"`. The quiz is generated from the retrieved excerpt exactly as the app does it, then a model is asked per question whether the excerpt supports the marked answer (grounded) and whether the question can be answered from the excerpt alone (answerable). Textbook chapter, 10 questions: 10/10 grounded, 10/10 answerable. Judge and generator were the same model in this run; set `JUDGE_MODEL` to a different one for an independent number.

Live play on the sample quiz, 5 games: 5 of 10 questions scored under 30% accuracy.

## Deploy

One Docker image, two processes (Node in front, uvicorn on localhost). `docker build -t quizroom .` — see the `Dockerfile`.

## Notes

- Rooms are in-memory; a restart ends live games.
- Quizzes are immutable once saved and public to anyone with the link.
- Generation is rate-limited per IP (5/hour) and capped daily — a fuse, not an abuse control.
