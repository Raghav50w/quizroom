/**
 * Pull JSON out of whatever the model actually returned.
 *
 * Models wrap JSON in markdown fences, prepend "Here's your quiz:", or refuse
 * in plain prose. The first two are recoverable here; the third has no JSON to
 * find and surfaces as a parse failure, which the caller retries once.
 */
export function extractJson(raw: string): unknown {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Fall back to the outermost braces, catching leading/trailing prose.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }

  throw new Error("No JSON found in model response");
}
