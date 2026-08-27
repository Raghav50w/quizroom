/**
 * Pages -> one cleaned string.
 *
 * Everything here removes page furniture that would otherwise be embedded and
 * retrieved as if it were content: a running header repeated 30 times is 30
 * near-identical strings competing with the actual text.
 *
 * Pure. No IO, no dependencies.
 */

/**
 * Drop a line appearing on more than this fraction of pages.
 *
 * Measured, not guessed. On a 30-page IEEE paper the three chrome lines land at
 * 47%, 50% and 50% — the footers alternate recto/verso ("2436 VOLUME 7, 2026"
 * one page, "VOLUME 7, 2026 2437" the next), so each form only reaches half the
 * pages and a 60% cut catches none of them. The densest real content line sits
 * at 17%, so 40% has clear air on both sides.
 */
const CHROME_PAGE_FRACTION = 0.4;

/** A repeated body paragraph is content. Chrome is short. */
const MAX_CHROME_LINE_CHARS = 100;

/** On two pages every shared line is 50-100%, which eats real text. */
const MIN_PAGES_FOR_CHROME_DETECTION = 3;

/** `12`, `- 12 -`, `Page 12`, `12 of 40`. */
const PAGE_NUMBER_RE = /^(?:page\s+)?[-–—\s]*\d+(?:\s+of\s+\d+)?[-–—\s]*$/i;

/**
 * Digits masked so "Page 3" and "Page 4" land in one bucket. Without this the
 * numbered footer is a different string on every page and counts as unique.
 */
function normalise(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase().replace(/\d+/g, "#");
}

/** Normalised forms that appear on more than CHROME_PAGE_FRACTION of pages. */
function findChromeLines(pages: string[]): Set<string> {
  if (pages.length < MIN_PAGES_FOR_CHROME_DETECTION) return new Set();

  const pageCounts = new Map<string, number>();
  for (const page of pages) {
    // Counted once per page: a line repeated within one page is not evidence
    // of a running header.
    const seen = new Set(
      page
        .split("\n")
        .map(normalise)
        .filter((line) => line !== "" && line.length <= MAX_CHROME_LINE_CHARS),
    );
    for (const line of seen) pageCounts.set(line, (pageCounts.get(line) ?? 0) + 1);
  }

  const threshold = pages.length * CHROME_PAGE_FRACTION;
  return new Set(
    [...pageCounts].filter(([, count]) => count > threshold).map(([line]) => line),
  );
}

export function cleanPages(pages: string[]): string {
  const chrome = findChromeLines(pages);

  const stripped = pages.map((page) =>
    page
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed === "") return true; // Blank runs collapse later, not here.
        if (chrome.has(normalise(line))) return false;
        return !PAGE_NUMBER_RE.test(trimmed);
      })
      .join("\n"),
  );

  return (
    stripped
      .join("\n")
      // After the line drops, so a break whose second half was a dropped line's
      // neighbour still joins. Lowercase-only on the right: "State-of-the-\nArt"
      // is a real compound, not a break, and joining it would corrupt the word.
      .replace(/([A-Za-z])-\n([a-z])/g, "$1$2")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
