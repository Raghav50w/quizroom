#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { generateQuiz } from "../src/generator/index.js";

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
  generate --file  notes.txt  [--count 10] [--title "..."]`;

const MAX_SOURCE_CHARS = 15_000;
const VALID_COUNTS = [5, 10, 15, 20];

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      topic: { type: "string" },
      text: { type: "string" },
      file: { type: "string" },
      count: { type: "string", default: "10" },
      title: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }

  const provided = [values.topic, values.text, values.file].filter(Boolean);
  if (provided.length !== 1) {
    process.stderr.write(`Give exactly one of --topic, --text, or --file.\n\n${USAGE}\n`);
    return 1;
  }

  const count = Number(values.count);
  if (!VALID_COUNTS.includes(count)) {
    process.stderr.write(`--count must be one of ${VALID_COUNTS.join(", ")}\n`);
    return 1;
  }

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

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
