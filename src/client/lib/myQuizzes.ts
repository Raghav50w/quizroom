/**
 * "My quizzes" lives entirely in localStorage: zero server work, no auth, no
 * cookie. Losing a link stops meaning losing the quiz — which will happen
 * during testing.
 */

const KEY = "quizroom.myQuizzes";
const MAX = 30;

export interface QuizRef {
  id: string;
  title: string;
  createdAt: string;
}

export function listMyQuizzes(): QuizRef[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QuizRef[]) : [];
  } catch {
    // A corrupt entry must not take the landing page down with it.
    return [];
  }
}

export function rememberQuiz(ref: QuizRef): void {
  const existing = listMyQuizzes().filter((quiz) => quiz.id !== ref.id);
  const next = [ref, ...existing].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode, quota, whatever — the quiz is still saved server-side.
  }
}
