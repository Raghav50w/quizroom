/**
 * Pure retrieval helpers — selection and ordering, no database.
 *
 * Split out from retrieve.ts so they can be tested without a database.
 *
 * Even sampling is honestly *not* vector search: it is index arithmetic. With no topic there
 * is nothing to search against, so we spread the picks across the document
 * instead of taking the first N. That covers the document's shape, not its
 * meaning — which is why the PDF form asks for a topic by default.
 */

/** Picks `count` items spread evenly across `items`, keeping input order. */
export function evenSample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  if (count <= 0) return [];

  const step = items.length / count;
  // Mid-interval (i + 0.5) rather than i * step: taking the left edge of each
  // interval always picks index 0 and never comes near the end of the document.
  return Array.from({ length: count }, (_, i) => items[Math.floor((i + 0.5) * step)]!);
}

/** Anything with a position in the document. */
export interface Ordered {
  ordinal: number;
}

/**
 * Document order, regardless of what order retrieval returned them in.
 *
 * Cosine search returns by similarity, so without this the model reads excerpts
 * shuffled — a conclusion before the setup that explains it.
 */
export function sortByOrdinal<T extends Ordered>(items: T[]): T[] {
  return [...items].sort((a, b) => a.ordinal - b.ordinal);
}
