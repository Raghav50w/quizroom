#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { generateQuiz } from "../src/generator/index.js";
import { chunkText } from "../src/generator/pdf/chunk.js";
import { cleanPages } from "../src/generator/pdf/clean.js";
import { extractPages } from "../src/generator/pdf/extract.js";
import { selectSource } from "../src/server/rag/retrieve.js";
import { storeChunks } from "../src/server/rag/store.js";

/**
 * CLI: quiz JSON from the terminal.
 *
 *   npm run generate -- --topic "photosynthesis" --count 10 > quiz.json
 *
 * Nothing but the payload reaches stdout. Progress, warnings, and errors all go
 * to stderr, so the redirect above yields a file that parses.
 */

const USAGE = `Usage:
  generate --topic "<topic>"  [--count 10] [--title "..."]
  generate --text  "<notes>"  [--count 10] [--title "..."]
  generate --file  notes.txt  [--count 10] [--title "..."]
  generate --pdf   notes.pdf  [--about "<query>"] [--count 10] [--title "..."]

--about narrows which part of a PDF the questions come from. Only valid with --pdf.`;

const MAX_SOURCE_CHARS = 15_000;
const VALID_COUNTS = [5, 10, 15, 20];

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      topic: { type: "string" },
      text: { type: "string" },
      file: { type: "string" },
      pdf: { type: "string" },
      // Not the source — the source is the PDF. This is which part of it to use.
      about: { type: "string" },
      count: { type: "string", default: "10" },
      title: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }

  const provided = [values.topic, values.text, values.file, values.pdf].filter(Boolean);
  if (provided.length !== 1) {
    process.stderr.write(`Give exactly one of --topic, --text, --file, or --pdf.\n\n${USAGE}\n`);
    return 1;
  }

  // --topic is already the source, so a PDF's retrieval query needs its own flag.
  if (values.about !== undefined && values.pdf === undefined) {
    process.stderr.write(`--about only makes sense with --pdf.\n\n${USAGE}\n`);
    return 1;
  }

  const count = Number(values.count);
  if (!VALID_COUNTS.includes(count)) {
    process.stderr.write(`--count must be one of ${VALID_COUNTS.join(", ")}\n`);
    return 1;
  }

  const source = values.pdf
    ? await sourceFromPdf(values.pdf, values.about ?? null)
    : values.file
      ? await readFile(values.file, "utf8")
      : (values.topic ?? values.text)!;

  if (source.trim().length === 0) {
    process.stderr.write("Source is empty.\n");
    return 1;
  }
  if (source.length > MAX_SOURCE_CHARS) {
    process.stderr.write(
      `Source is ${source.length} chars, limit is ${MAX_SOURCE_CHARS}.\n`,
    );
    return 1;
  }

  const { quiz, shortfall } = await generateQuiz({
    source,
    count,
    // Retrieved excerpts start mid-sentence, so the generator's derive-from-
    // first-line fallback yields titles like "ng losses. In contrast,". For a
    // PDF the query — or failing that the filename — is what a human meant.
    ...(values.title || values.pdf
      ? { title: values.title || pdfTitle(values.pdf!, values.about) }
      : {}),
    ...(values.pdf ? { sourceMode: "pdf" as const } : {}),
    log: (message) => process.stderr.write(`${message}\n`),
  });

  if (shortfall) {
    process.stderr.write(
      `Warning: ${shortfall.delivered} of ${shortfall.requested} questions passed validation.\n`,
    );
  }

  process.stdout.write(`${JSON.stringify(quiz, null, 2)}\n`);
  return 0;
}

/** The query if there was one, else the filename without its extension. */
function pdfTitle(path: string, about: string | undefined): string {
  if (about?.trim()) return about.trim();
  return basename(path, extname(path)).replace(/[_-]+/g, " ").trim();
}

/**
 * PDF -> the excerpt the questions get written from.
 *
 * Extract and chunk are pure; embedding and retrieval need the database, which
 * is why they live in server/rag. A script may import both — scripts aren't
 * generator/, so the rule that generator/ imports nothing from server/ holds.
 *
 * Every chunk is embedded and stored, then four are selected. Storing the whole
 * document rather than only what we retrieve is what makes a second run with a
 * different --about cheap.
 */
async function sourceFromPdf(path: string, about: string | null): Promise<string> {
  const log = (message: string) => process.stderr.write(`${message}\n`);

  const pages = await extractPages(path);
  const chunks = chunkText(cleanPages(pages));
  if (chunks.length === 0) throw new Error("No usable text after cleaning.");
  log(`${pages.length} pages -> ${chunks.length} chunks`);

  const documentId = await storeChunks(chunks, (ms) =>
    log(`provider quota reached — waiting ${ms / 1000}s for the next window`),
  );
  log(`embedded and stored as document ${documentId}`);

  const source = await selectSource(documentId, about);
  log(
    about
      ? `retrieved ${source.length} chars for "${about}"`
      : `sampled ${source.length} chars evenly (no --about given)`,
  );

  return source;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
