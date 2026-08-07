import { useEffect, useState } from "react";

/**
 * The link is the credential — there is no other way back to a quiz, so it has
 * to be visible and one tap to copy.
 */
export function ShareLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard needs a secure context; selecting the text is the fallback.
      const input = document.getElementById("share-url") as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <div>
      <p className="mb-2 text-center text-sm font-medium text-slate-600">
        Share this link — anyone with it can play
      </p>
      <div className="flex gap-2">
        <input
          id="share-url"
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
          className="w-full min-w-0 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className={`shrink-0 rounded-xl px-5 py-3 font-semibold text-white transition ${
            copied ? "bg-emerald-600" : "bg-slate-900 hover:bg-slate-700"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
