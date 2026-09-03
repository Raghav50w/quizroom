import { useEffect, useState } from "react";
import type { Question, Quiz } from "../../shared/quiz.js";
import {
  ApiError,
  fetchPdfJob,
  generateQuiz,
  ping,
  uploadPdf,
  type PdfStep,
} from "../lib/api.js";
import { loadDraft } from "../lib/draft.js";
import { navigate } from "../lib/router.js";
import { Review } from "./Review.js";

const COUNTS = [5, 10, 15, 20] as const;
const MAX_SOURCE_CHARS = 15_000;

type Stage =
  | { name: "input" }
  | { name: "generating" }
  | { name: "uploading"; jobId: string; step: PdfStep }
  | { name: "review"; questions: Question[]; title: string; sourceMode: Quiz["sourceMode"] };

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Two messages, as promised. Anything else gets the generic error. */
const PDF_ERRORS: Record<string, string> = {
  no_text_found: "No text found in that PDF. Scanned documents aren't supported yet.",
  file_too_large: "That file is too large — the limit is 10MB.",
  too_many_pages: "That PDF is too long — the limit is 50 pages.",
};

const STEP_LABELS: Record<PdfStep, string> = {
  reading: "Reading the PDF…",
  generating: "Writing questions…",
  done: "Done",
  failed: "Failed",
};

/**
 * Create is desktop-first on purpose — hosts create on a laptop and play on a
 * phone. Everything here is React state; nothing is written until Review posts.
 */
export function Create() {
  // A generation survives Back and refresh: pick up where the tab left off.
  const [stage, setStage] = useState<Stage>(() => {
    const draft = loadDraft();
    return draft
      ? {
          name: "review",
          questions: draft.questions,
          title: draft.title,
          sourceMode: draft.sourceMode,
        }
      : { name: "input" };
  });
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Someone can spend 16 minutes pasting notes; the free box sleeps at 15.
  // The cold start on page load is absorbed by the load itself — this covers
  // the case that actually bites.
  useEffect(() => {
    const timer = setInterval(() => void ping(), 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Polls while a PDF job runs. 1.5s is frequent enough to feel live without
  // making 40 requests for a job that takes a minute.
  useEffect(() => {
    if (stage.name !== "uploading") return;
    const { jobId } = stage;
    let cancelled = false;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const job = await fetchPdfJob(jobId);
          if (cancelled) return;

          if (job.step === "done" && job.quiz) {
            if (job.shortfall) {
              setNotice(
                `${job.shortfall.delivered} of ${job.shortfall.requested} questions passed validation. You can add more by hand.`,
              );
            }
            setStage({
              name: "review",
              questions: job.quiz.questions,
              title: job.quiz.title,
              sourceMode: "pdf",
            });
          } else if (job.step === "failed") {
            setError(PDF_ERRORS[job.error ?? ""] ?? "That PDF could not be turned into a quiz.");
            setStage({ name: "input" });
          } else {
            setStage({ name: "uploading", jobId, step: job.step });
          }
        } catch {
          if (cancelled) return;
          setError("Lost contact with the server.");
          setStage({ name: "input" });
        }
      })();
    }, 1_500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Only the id matters — re-running on every step change would reset the timer.
  }, [stage.name === "uploading" ? stage.jobId : null]);

  async function onUpload() {
    if (!file) return;
    setError(null);
    setNotice(null);

    if (file.size > MAX_PDF_BYTES) {
      setError(PDF_ERRORS.file_too_large!);
      return;
    }

    try {
      const { jobId } = await uploadPdf(file, count, prompt.trim());
      setStage({ name: "uploading", jobId, step: "reading" });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not reach the server.");
    }
  }

  async function onGenerate() {
    setError(null);
    setNotice(null);
    setStage({ name: "generating" });
    try {
      const { quiz, shortfall } = await generateQuiz(source.trim(), count);
      if (shortfall) {
        setNotice(
          `${shortfall.delivered} of ${shortfall.requested} questions passed validation. You can add more by hand.`,
        );
      }
      setStage({
        name: "review",
        questions: quiz.questions,
        // The generator titles a quiz from the first line of the source. That
        // reads fine for "the Roman Empire" and terribly for pasted notes, so
        // past a sentence or so, leave it blank and make the user name it.
        title: source.trim().length > 80 ? "" : quiz.title,
        sourceMode: "text",
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not reach the server.");
      setStage({ name: "input" });
    }
  }

  function startManual() {
    setStage({ name: "review", questions: [], title: "", sourceMode: "manual" });
  }

  if (stage.name === "review") {
    return (
      <Review
        initialQuestions={stage.questions}
        initialTitle={stage.title}
        sourceMode={stage.sourceMode}
        notice={notice}
        onBack={() => setStage({ name: "input" })}
      />
    );
  }

  const busy = stage.name === "generating" || stage.name === "uploading";

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        &larr; Back
      </button>

      <h1 className="mt-4 text-3xl font-bold text-slate-900">Make a quiz</h1>

      <label htmlFor="source" className="mt-8 block text-sm font-medium text-slate-700">
        Paste your notes, or describe a topic
      </label>
      <textarea
        id="source"
        value={source}
        disabled={busy}
        onChange={(event) => setSource(event.target.value.slice(0, MAX_SOURCE_CHARS))}
        rows={10}
        placeholder="e.g. the French Revolution&#10;&#10;...or paste a few pages of lecture notes."
        className="mt-2 w-full resize-y rounded-2xl border-2 border-slate-200 p-4 text-base text-slate-800 outline-none focus:border-indigo-500 disabled:bg-slate-50"
      />
      <p className="mt-1 text-right text-xs text-slate-400">
        {source.length.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()}
      </p>

      <div className="mt-8 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">or</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <label htmlFor="pdf" className="mt-6 block text-sm font-medium text-slate-700">
        Upload a PDF
      </label>
      <input
        id="pdf"
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="mt-2 w-full rounded-2xl border-2 border-dashed border-slate-200 p-4 text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:border-slate-300 disabled:opacity-40"
      />

      <label htmlFor="prompt" className="mt-4 block text-sm font-medium text-slate-700">
        What should the quiz focus on? <span className="text-slate-400">(optional)</span>
      </label>
      <input
        id="prompt"
        value={prompt}
        disabled={busy}
        onChange={(event) => setPrompt(event.target.value.slice(0, 200))}
        placeholder="e.g. cell division"
        className="mt-2 w-full rounded-2xl border-2 border-slate-200 p-4 text-base text-slate-800 outline-none focus:border-indigo-500 disabled:bg-slate-50"
      />
      <p className="mt-1 text-xs text-slate-400">
        Without this, questions are drawn evenly from across the document.
      </p>

      <p className="mt-6 text-sm font-medium text-slate-700">How many questions?</p>
      <div className="mt-2 flex gap-2">
        {COUNTS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={() => setCount(value)}
            className={`w-20 rounded-xl border-2 py-3 text-lg font-semibold transition ${
              value === count
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
      )}

      <button
        type="button"
        disabled={busy || (file === null && source.trim().length === 0)}
        onClick={() => void (file ? onUpload() : onGenerate())}
        className="mt-8 w-full rounded-2xl bg-indigo-600 py-5 text-xl font-bold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40"
      >
        {stage.name === "uploading"
          ? STEP_LABELS[stage.step]
          : busy
            ? "Writing questions…"
            : file
              ? "Generate from PDF"
              : "Generate"}
      </button>
      {busy && (
        <p className="mt-3 text-center text-sm text-slate-500">
          {stage.name === "uploading"
            ? "A PDF takes 30–60 seconds. Keep the tab open."
            : "This takes 5–15 seconds. Keep the tab open."}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={startManual}
        className="mt-4 w-full rounded-2xl border-2 border-slate-200 py-4 text-base font-medium text-slate-600 transition hover:border-slate-300 disabled:opacity-40"
      >
        Write questions myself
      </button>
    </div>
  );
}
