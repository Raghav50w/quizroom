import type { Question, Quiz } from "../../shared/quiz.js";

/**
 * The reviewed-but-unsaved quiz, held in sessionStorage.
 *
 * Generating costs an API call and 5-15 seconds, and Review lives at the same
 * URL as Create — so browser Back, a refresh, or a stray click used to throw
 * the whole batch away. This makes that recoverable.
 *
 * sessionStorage, not localStorage: a draft belongs to the tab you were working
 * in, and shouldn't reappear in a new window days later.
 */

const KEY = "quizroom.draft";

export interface Draft {
  title: string;
  questions: Question[];
  sourceMode: Quiz["sourceMode"];
}

export function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    return Array.isArray(parsed.questions) && parsed.questions.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Private mode or quota. Losing the draft is the old behaviour, not worse.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
