import { useState } from "react";
import type { Question, Quiz } from "../../shared/quiz.js";
import { questionSchema, quizSchema } from "../../shared/quiz.js";
import { ApiError, saveQuiz } from "../lib/api.js";
import { rememberQuiz } from "../lib/myQuizzes.js";
import { navigate } from "../lib/router.js";

interface ReviewProps {
  initialQuestions: Question[];
  initialTitle: string;
  sourceMode: Quiz["sourceMode"];
  notice: string | null;
  onBack: () => void;
}

const MAX_QUESTIONS = 20;

/**
 * All editing happens here, in React state, then one POST. There are no
 * mutation routes — once saved, a quiz is immutable, so this is the only
 * chance to fix anything.
 *
 * No reorder (drag-drop is disproportionately painful and order barely
 * matters) and no regenerate (a one-click LLM call is the easiest way to burn
 * credits). Bad question: delete it and retype.
 */
export function Review({
  initialQuestions,
  initialTitle,
  sourceMode,
  notice,
  onBack,
}: ReviewProps) {
  const [title, setTitle] = useState(initialTitle);
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(index: number, patch: Partial<Question>) {
    setQuestions((current) =>
      current.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    );
  }

  function updateOption(index: number, optionIndex: number, value: string) {
    setQuestions((current) =>
      current.map((question, i) => {
        if (i !== index) return question;
        const options = [...question.options] as Question["options"];
        options[optionIndex] = value;
        return { ...question, options };
      }),
    );
  }

  function addManual() {
    setQuestions((current) => [
      ...current,
      {
        id: `manual-${Date.now()}-${current.length}`,
        stem: "",
        options: ["", "", "", ""],
        correctIndex: 0,
        origin: "manual",
      },
    ]);
  }

  const invalid = questions
    .map((question, index) => ({ index, ok: questionSchema.safeParse(question).success }))
    .filter((entry) => !entry.ok)
    .map((entry) => entry.index);

  const canSave =
    title.trim().length > 0 &&
    questions.length >= 1 &&
    questions.length <= MAX_QUESTIONS &&
    invalid.length === 0;

  async function onSave() {
    setError(null);
    const draft = {
      schemaVersion: 1 as const,
      id: "pending",
      createdAt: new Date().toISOString(),
      title: title.trim(),
      sourceMode,
      questions,
    };

    // Same schema the server enforces, so a mistake surfaces here rather than
    // as a 400 after a round trip.
    const parsed = quizSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Something is still invalid.");
      return;
    }

    setSaving(true);
    try {
      const { quiz } = await saveQuiz({ title: draft.title, sourceMode, questions });
      rememberQuiz({ id: quiz.id, title: quiz.title, createdAt: quiz.createdAt });
      navigate(`/q/${quiz.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not reach the server.");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        &larr; Start over
      </button>

      <h1 className="mt-4 text-3xl font-bold text-slate-900">Review</h1>
      <p className="mt-1 text-slate-500">
        Fix anything you like. Once you save, the quiz can't be edited.
      </p>

      {notice && (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{notice}</p>
      )}

      <label htmlFor="title" className="mt-8 block text-sm font-medium text-slate-700">
        Quiz title
      </label>
      <input
        id="title"
        value={title}
        onChange={(event) => setTitle(event.target.value.slice(0, 120))}
        placeholder="Give it a name"
        className="mt-2 w-full rounded-2xl border-2 border-slate-200 p-4 text-lg font-medium outline-none focus:border-indigo-500"
      />

      <ul className="mt-8 space-y-6">
        {questions.map((question, index) => (
          <li
            key={question.id}
            className={`rounded-2xl border-2 p-5 ${
              invalid.includes(index) ? "border-amber-300 bg-amber-50/40" : "border-slate-200"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <span className="mt-1 text-sm font-semibold text-slate-400">{index + 1}</span>
              <button
                type="button"
                onClick={() => setQuestions((c) => c.filter((_, i) => i !== index))}
                className="text-sm font-medium text-rose-600 hover:text-rose-700"
              >
                Delete
              </button>
            </div>

            <textarea
              value={question.stem}
              rows={2}
              placeholder="Question (10–200 characters)"
              onChange={(event) => update(index, { stem: event.target.value.slice(0, 200) })}
              className="mt-2 w-full resize-y rounded-xl border-2 border-slate-200 p-3 text-base outline-none focus:border-indigo-500"
            />

            <p className="mt-4 text-xs font-medium tracking-wide text-slate-400 uppercase">
              Tap the circle to mark the correct answer
            </p>
            <div className="mt-2 space-y-2">
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={`Mark option ${optionIndex + 1} correct`}
                    onClick={() => update(index, { correctIndex: optionIndex })}
                    className={`size-6 shrink-0 rounded-full border-2 transition ${
                      question.correctIndex === optionIndex
                        ? "border-emerald-600 bg-emerald-600"
                        : "border-slate-300 hover:border-slate-400"
                    }`}
                  />
                  <input
                    value={option}
                    placeholder={`Option ${optionIndex + 1}`}
                    onChange={(event) =>
                      updateOption(index, optionIndex, event.target.value.slice(0, 80))
                    }
                    className="w-full rounded-xl border-2 border-slate-200 p-3 outline-none focus:border-indigo-500"
                  />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {questions.length < MAX_QUESTIONS && (
        <button
          type="button"
          onClick={addManual}
          className="mt-6 w-full rounded-2xl border-2 border-dashed border-slate-300 py-4 font-medium text-slate-600 hover:border-slate-400"
        >
          + Add a question
        </button>
      )}

      {invalid.length > 0 && (
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          {invalid.length} question{invalid.length === 1 ? "" : "s"} still need work — each
          needs a 10-character question and four different answers.
        </p>
      )}
      {error && <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}

      <button
        type="button"
        disabled={!canSave || saving}
        onClick={() => void onSave()}
        className="mt-6 mb-10 w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save quiz"}
      </button>
    </div>
  );
}
