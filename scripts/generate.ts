#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { generateQuiz } from "../src/generator/index.js";
import { chunkText } from "../src/generator/pdf/chunk.js";
import { cleanPages } from "../src/generator/pdf/clean.js";
import { extractPages } from "../src/generator/pdf/extract.js";

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

  if (values.pdf !== undefined) return dumpChunks(values.pdf);

  const source = values.file
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
    ...(values.title ? { title: values.title } : {}),
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

/**
 * TEMPORARY — session A stops here.
 *
 * Prints the cleaned chunks so the extraction and cleaning can be judged by eye
 * before anything gets embedded. Session B replaces this with the real pipeline:
 * embed the chunks, store them, retrieve 4 by `--about`, then generateQuiz.
 *
 * stderr, like every other diagnostic here — stdout stays reserved for payload.
 */
async function dumpChunks(path: string): Promise<number> {
  const pages = await extractPages(path);
  const cleaned = cleanPages(pages);
  const chunks = chunkText(cleaned);

  process.stderr.write(
    `${pages.length} pages -> ${cleaned.length} chars cleaned -> ${chunks.length} chunks\n`,
  );
  for (const chunk of chunks) {
    process.stderr.write(
      `\n${"=".repeat(70)}\nchunk ${chunk.ordinal} (${chunk.text.length} chars)\n${"=".repeat(70)}\n${chunk.text}\n`,
    );
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
