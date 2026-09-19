import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "../src/config.js";
import { generateQuiz } from "../src/generator/index.js";
import { callLLM } from "../src/generator/llm.js";
import { buildPrompt } from "../src/generator/prompt.js";
import { dedupe, extractJson, rawResponseSchema, runGate } from "../src/generator/validate.js";
import { ingestPdf, selectSource } from "../src/server/pdf.js";
import type { Question } from "../src/shared/quiz.js";
import { quizAccuracy } from "../src/server/stats.js";

/**
 * Measures the generation pipeline so the README can quote real numbers.
 *
 *   npm run eval
 *   npm run eval -- --pdf notes.pdf --about "cell division" [--pdf other.pdf ...]
 *
 * Needs .env. The PDF part needs the Python service running:
 *   uvicorn main:app --app-dir rag --port 8000
 *
 * The PDF part is the one that judges output quality rather than shape: a
 * quiz is generated from the retrieved excerpt exactly as the app does it,
 * then a second model is asked, per question, whether the excerpt supports
 * the marked answer and whether the stem is answerable from the excerpt at
 * all. Set JUDGE_MODEL (and optionally JUDGE_API_KEY) in .env so the judge is
 * not the generator grading itself.
 *
 * Prints one markdown table per section. Nothing is saved.
 */

const COUNT = 10;
const ASKED = COUNT + 2; // Same overshoot as the app.

const TOPICS = [
  "the French Revolution",
  "photosynthesis",
  "the Roman Empire",
  "how vaccines work",
  "the water cycle",
];

const NOTES = [
  "Mitochondria are the site of cellular respiration. They have a double membrane; the inner membrane is folded into cristae, which increase surface area for the electron transport chain. ATP synthase uses the proton gradient across the inner membrane to make ATP.",
  "In 1789 the Estates-General met for the first time since 1614. The Third Estate declared itself the National Assembly and took the Tennis Court Oath, swearing not to disband until a constitution was written. The Bastille fell on 14 July.",
  "TCP provides reliable, ordered delivery using sequence numbers and acknowledgements. A three-way handshake (SYN, SYN-ACK, ACK) opens a connection. Congestion control uses slow start and additive-increase multiplicative-decrease.",
  "Supply and demand: when price rises, quantity demanded falls and quantity supplied rises. The equilibrium price is where the two curves cross. A price ceiling below equilibrium causes a shortage; a price floor above it causes a surplus.",
  "Plate tectonics: the lithosphere is broken into plates that move over the asthenosphere. Divergent boundaries create new crust at mid-ocean ridges; convergent boundaries cause subduction and mountain building; transform boundaries slide past each other, causing earthquakes.",
];

interface SourceResult {
  label: string;
  rawCount: number;
  keptCount: number;
  uniqueCount: number;
  dropReasons: Record<string, number>;
  positions: number[]; // correctIndex of every raw question, before shuffle
  ms: number;
}

async function measureSource(label: string, source: string): Promise<SourceResult> {
  const started = Date.now();
  const completion = await callLLM(buildPrompt(source, ASKED));
  const ms = Date.now() - started;

  const raw = rawResponseSchema.parse(extractJson(completion)).questions;
  const { kept, dropped } = runGate(raw);
  const unique = dedupe(kept);

  const dropReasons: Record<string, number> = {};
  for (const drop of dropped) {
    dropReasons[drop.reason] = (dropReasons[drop.reason] ?? 0) + 1;
  }

  // Position of the correct answer in the raw output, before any shuffle.
  const positions: number[] = [];
  for (const question of raw) {
    const index = (question as { correctIndex?: unknown }).correctIndex;
    if (typeof index === "number" && index >= 0 && index <= 3) positions.push(index);
  }

  return {
    label,
    rawCount: raw.length,
    keptCount: kept.length,
    uniqueCount: unique.length,
    dropReasons,
    positions,
    ms,
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`;
}

async function evalGeneration(): Promise<void> {
  const results: SourceResult[] = [];
  const skipped: string[] = [];

  const sources: Array<{ label: string; text: string }> = [];
  for (const topic of TOPICS) sources.push({ label: `topic: ${topic}`, text: topic });
  for (let i = 0; i < NOTES.length; i++) sources.push({ label: `notes ${i + 1}`, text: NOTES[i]! });

  for (const source of sources) {
    process.stderr.write(`${source.label}\n`);
    try {
      results.push(await measureSource(source.label, source.text));
    } catch (error) {
      // A provider outage on one source should not throw away the others.
      process.stderr.write(`  skipped: ${(error as Error).message.split("\n")[0]}\n`);
      skipped.push(source.label);
    }
  }

  console.log("\n## Generation\n");
  console.log("| Source | Raw | Passed gate | After dedupe | Short of " + COUNT + "? | ms |");
  console.log("|---|---|---|---|---|---|");
  for (const r of results) {
    const short = r.uniqueCount < COUNT ? `yes (${r.uniqueCount})` : "no";
    console.log(`| ${r.label} | ${r.rawCount} | ${r.keptCount} | ${r.uniqueCount} | ${short} | ${r.ms} |`);
  }

  let totalRaw = 0;
  let totalKept = 0;
  let totalUnique = 0;
  let shortfalls = 0;
  const reasons: Record<string, number> = {};
  const positions = [0, 0, 0, 0];
  const times: number[] = [];

  for (const r of results) {
    totalRaw += r.rawCount;
    totalKept += r.keptCount;
    totalUnique += r.uniqueCount;
    if (r.uniqueCount < COUNT) shortfalls++;
    for (const [reason, n] of Object.entries(r.dropReasons)) {
      reasons[reason] = (reasons[reason] ?? 0) + n;
    }
    for (const position of r.positions) positions[position]!++;
    times.push(r.ms);
  }

  console.log("\n### Totals\n");
  console.log(`- Raw questions returned: ${totalRaw}`);
  console.log(`- Rejected by gate: ${totalRaw - totalKept} (${percent(totalRaw - totalKept, totalRaw)})`);
  console.log(`- Removed as near-duplicates: ${totalKept - totalUnique}`);
  console.log(`- Sources that fell short of ${COUNT}: ${shortfalls} of ${results.length}`);
  console.log(`- Latency p50 / p95: ${percentile(times, 50)} ms / ${percentile(times, 95)} ms`);
  if (skipped.length > 0) console.log(`- Skipped (provider error): ${skipped.join(", ")}`);

  console.log("\n### Drop reasons\n");
  console.log("| Reason | Count |");
  console.log("|---|---|");
  for (const [reason, n] of Object.entries(reasons)) console.log(`| ${reason} | ${n} |`);

  console.log("\n### Correct answer position before shuffle\n");
  console.log("| Position | Count | Share |");
  console.log("|---|---|---|");
  for (let i = 0; i < 4; i++) {
    console.log(`| ${["A", "B", "C", "D"][i]} | ${positions[i]} | ${percent(positions[i]!, totalRaw)} |`);
  }
}

// ---------------------------------------------------------------------------
// PDF: retrieval + generation, judged
// ---------------------------------------------------------------------------

interface Verdict {
  grounded: boolean;
  answerable: boolean;
}

/**
 * One question, one call. Two yes/no judgements rather than a score: a 1-5
 * rating from a model is noise dressed as precision, and a binary is easy to
 * spot-check by hand against the printed stems.
 */
function judgePrompt(excerpt: string, question: Question): string {
  const options = question.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n");
  return `You are checking a multiple-choice question against the source text it was written from.

SOURCE, between the --- lines:
---
${excerpt}
---

QUESTION: ${question.stem}
${options}
MARKED CORRECT: ${"ABCD"[question.correctIndex]}

Answer two things, strictly from the source:
- grounded: does the source state or directly imply that the marked option is correct?
- answerable: could a reader answer this question using only the source, with no outside knowledge?

Respond with JSON only: {"grounded": true|false, "answerable": true|false}`;
}

/**
 * Free-tier keys allow about 5 requests a minute. One call every 13s stays
 * under that; a 429 anyway means the bucket was already partly spent, so wait
 * a full minute once before giving up on the question.
 */
const CALL_INTERVAL_MS = 13_000;
const RATE_LIMIT_WAIT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paced<T>(call: () => Promise<T>): Promise<T> {
  await sleep(CALL_INTERVAL_MS);
  try {
    return await call();
  } catch (error) {
    if (!(error as Error).message.includes("429")) throw error;
    await sleep(RATE_LIMIT_WAIT_MS);
    return call();
  }
}

async function judge(excerpt: string, question: Question): Promise<Verdict> {
  const completion = await paced(() =>
    callLLM(judgePrompt(excerpt, question), {
      model: config.JUDGE_MODEL,
      apiKey: config.JUDGE_API_KEY,
    }),
  );
  const parsed = extractJson(completion) as Partial<Verdict>;
  return { grounded: parsed.grounded === true, answerable: parsed.answerable === true };
}

interface PdfResult {
  label: string;
  chunks: number;
  questions: number;
  grounded: number;
  answerable: number;
  ungrounded: string[];
}

async function evalPdf(pdfPath: string, about: string): Promise<PdfResult> {
  const label = about ? `${basename(pdfPath)} ("${about}")` : basename(pdfPath);
  process.stderr.write(`pdf: ${label}\n`);

  const file = await readFile(pdfPath);
  const { documentId, chunks } = await ingestPdf(file, basename(pdfPath));
  const excerpt = await selectSource(documentId, about || null);

  const { quiz } = await paced(() =>
    generateQuiz({
      source: excerpt,
      count: COUNT,
      sourceMode: "pdf",
      title: about || basename(pdfPath),
      prompt: about || undefined,
    }),
  );

  const result: PdfResult = { label, chunks, questions: 0, grounded: 0, answerable: 0, ungrounded: [] };
  for (const question of quiz.questions) {
    const verdict = await judge(excerpt, question);
    result.questions++;
    if (verdict.grounded) result.grounded++;
    else result.ungrounded.push(question.stem);
    if (verdict.answerable) result.answerable++;
  }
  return result;
}

async function evalPdfs(pdfs: Array<{ path: string; about: string }>): Promise<void> {
  const results: PdfResult[] = [];
  for (const pdf of pdfs) {
    try {
      results.push(await evalPdf(pdf.path, pdf.about));
    } catch (error) {
      process.stderr.write(`  skipped: ${(error as Error).message.split("\n")[0]}\n`);
    }
  }
  if (results.length === 0) return;

  const judgeModel = config.JUDGE_MODEL ?? config.LLM_MODEL;
  console.log(`\n## PDF quizzes (generator ${config.LLM_MODEL}, judge ${judgeModel})\n`);
  console.log("| Source | Chunks | Questions | Grounded | Answerable |");
  console.log("|---|---|---|---|---|");
  let questions = 0;
  let grounded = 0;
  let answerable = 0;
  for (const r of results) {
    questions += r.questions;
    grounded += r.grounded;
    answerable += r.answerable;
    console.log(
      `| ${r.label} | ${r.chunks} | ${r.questions} | ${r.grounded} (${percent(r.grounded, r.questions)}) | ${r.answerable} (${percent(r.answerable, r.questions)}) |`,
    );
  }
  console.log(`| **all** | | ${questions} | ${grounded} (${percent(grounded, questions)}) | ${answerable} (${percent(answerable, questions)}) |`);

  const ungrounded = results.flatMap((r) => r.ungrounded.map((stem) => `- ${r.label}: ${stem}`));
  if (ungrounded.length > 0) {
    console.log("\n### Judged not grounded\n");
    for (const line of ungrounded) console.log(line);
  }
}

async function evalLivePlay(): Promise<void> {
  const rows = await quizAccuracy("sample");
  if (rows.length === 0) return;

  let answered = 0;
  let hard = 0;
  for (const row of rows) {
    if (row.answerCount > 0) answered++;
    if (row.answerCount > 0 && row.accuracy < 0.3) hard++;
  }

  console.log("\n## Live play (sample quiz)\n");
  console.log("| # | Question | Answers | Correct | Accuracy |");
  console.log("|---|---|---|---|---|");
  rows.forEach((row, i) => {
    console.log(`| ${i + 1} | ${row.stem} | ${row.answerCount} | ${row.correctCount} | ${percent(row.correctCount, row.answerCount)} |`);
  });
  console.log(`\n- Questions with any answers: ${answered} of ${rows.length}`);
  console.log(`- Questions under 30% accuracy: ${hard}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pdfs: Array<{ path: string; about: string }> = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pdf" && args[i + 1]) {
      const path = args[i + 1]!;
      let about = "";
      if (args[i + 2] === "--about" && args[i + 3]) about = args[i + 3]!;
      pdfs.push({ path, about });
    }
  }

  // --pdf-only: just the judged PDF section, so a quota-limited key is spent on it.
  const pdfOnly = args.includes("--pdf-only");
  if (!pdfOnly) await evalGeneration();
  await evalPdfs(pdfs);
  if (!pdfOnly) await evalLivePlay();
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
