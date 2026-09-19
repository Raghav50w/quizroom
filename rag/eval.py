"""Retrieval eval: does cosine search find the right passage, and does it beat
the obvious alternatives?

    python rag/eval.py pdf/              every PDF in the folder with labels
    python rag/eval.py pdf/OS_test.pdf   one PDF
    python rag/eval.py pdf/ --sweep      also re-run cosine search at several chunk sizes

Needs DATABASE_URL in the environment (same as the service). No LLM calls;
embeddings are local. Everything it stores, it deletes at the end.

Labels live in evals/queries.py as (query, fingerprint) pairs. A chunk is
relevant to a query if it contains the fingerprint — usually one chunk, two
when the overlap puts the phrase on both sides of a boundary. Three methods
are scored against the same stored chunks:

    cosine   pgvector nearest neighbours — what ships
    bm25     lexical ranking over the same chunks, in memory — the standard baseline
    even     the no-topic path: chunks spread evenly across the document, no search

and reported as hit@k, MRR, nDCG@k and precision@k, the usual retrieval set.
"""

from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "evals"))

from rank_bm25 import BM25Okapi

from pdf import CHUNK_OVERLAP, CHUNK_SIZE, pdf_to_chunks
from queries import QUERIES
import store
from store import StoredChunk, delete_document, list_chunks, search_chunks, store_chunks

TOP_K = 4  # Same as CHUNKS_PER_PROMPT in main.py.

# Overlap is scaled with size so the sweep varies one thing. 3000/400 is what ships.
SWEEP_SIZES = [1000, 2000, 3000]

METHODS = ["cosine", "bm25", "even"]


def even_sample(items: list[StoredChunk], count: int) -> list[StoredChunk]:
    """Copy of the no-topic path in main.py, so the baseline is exactly what ships."""
    if len(items) <= count:
        return list(items)
    step = len(items) / count
    return [items[int((i + 0.5) * step)] for i in range(count)]


def tokenize(text: str) -> list[str]:
    return text.lower().split()


def bm25_search(index: BM25Okapi, stored: list[StoredChunk], query: str, k: int) -> list[StoredChunk]:
    scores = index.get_scores(tokenize(query))
    order = sorted(range(len(stored)), key=lambda i: scores[i], reverse=True)
    return [stored[i] for i in order[:k]]


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def relevant_ordinals(stored: list[StoredChunk], phrase: str) -> set[int]:
    needle = phrase.lower()
    return {chunk.ordinal for chunk in stored if needle in chunk.text.lower()}


@dataclass
class Score:
    rank: int | None  # 1-based rank of the first relevant chunk, or None
    ndcg: float
    precision: float

    @property
    def hit(self) -> bool:
        return self.rank is not None

    @property
    def rr(self) -> float:
        return 1 / self.rank if self.rank else 0.0


def score(retrieved: list[StoredChunk], relevant: set[int], k: int) -> Score:
    """Binary relevance. nDCG's ideal ranking has every relevant chunk first."""
    gains = [1 if chunk.ordinal in relevant else 0 for chunk in retrieved[:k]]
    rank = next((i + 1 for i, g in enumerate(gains) if g), None)

    dcg = sum(g / math.log2(i + 2) for i, g in enumerate(gains))
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(relevant), k)))
    ndcg = dcg / ideal if ideal else 0.0

    return Score(rank=rank, ndcg=ndcg, precision=sum(gains) / k)


@dataclass
class Totals:
    scores: list[Score] = field(default_factory=list)

    @property
    def n(self) -> int:
        return len(self.scores)

    @property
    def hits(self) -> int:
        return sum(s.hit for s in self.scores)

    def mean(self, attribute: str) -> float:
        return sum(getattr(s, attribute) for s in self.scores) / self.n if self.n else 0.0

    def row(self, label: str) -> str:
        return (
            f"| {label} | {self.hits}/{self.n} ({self.hits / self.n:.0%}) | {self.mean('rr'):.2f}"
            f" | {self.mean('ndcg'):.2f} | {self.mean('precision'):.2f} |"
        )


TOTALS_HEADER = f"| Method | Hit@{TOP_K} | MRR | nDCG@{TOP_K} | P@{TOP_K} |\n|---|---|---|---|---|"


def check_chunking(text_chunks, size: int, overlap: int) -> list[str]:
    """Structural sanity on the chunker, reported as a list of problems."""
    problems = []
    if not text_chunks:
        return ["no chunks produced"]
    for chunk in text_chunks:
        if not chunk.text.strip():
            problems.append(f"chunk {chunk.ordinal} is empty")
        if len(chunk.text) > size:
            problems.append(f"chunk {chunk.ordinal} is {len(chunk.text)} chars, over {size}")
    for previous, current in zip(text_chunks, text_chunks[1:]):
        if current.text[:overlap] != previous.text[-overlap:]:
            problems.append(f"chunks {previous.ordinal}->{current.ordinal} do not overlap by {overlap}")
    return problems


# ---------------------------------------------------------------------------
# One document
# ---------------------------------------------------------------------------


@dataclass
class DocumentResult:
    chunks: int
    ingest_seconds: float
    totals: dict[str, Totals]
    search_seconds: list[float]


def evaluate_document(path: Path, queries: list[tuple[str, str]], stored_ids: list[str]) -> DocumentResult:
    data = path.read_bytes()
    chunks = pdf_to_chunks(data)

    started = time.perf_counter()
    document_id = store_chunks(chunks)
    ingest_seconds = time.perf_counter() - started
    stored_ids.append(document_id)

    stored = list_chunks(document_id)
    bm25 = BM25Okapi([tokenize(chunk.text) for chunk in stored])
    baseline = even_sample(stored, TOP_K)

    # Every label must exist somewhere in the document, or the eval is broken.
    missing = [phrase for _, phrase in queries if not relevant_ordinals(stored, phrase)]
    if missing:
        raise SystemExit(f"Label error in {path.name}: not in the document: {missing}")

    print(f"\n## {path.name}\n")
    print(f"- {len(data) / 1024 / 1024:.1f} MB, {len(chunks)} chunks of {CHUNK_SIZE} chars, {CHUNK_OVERLAP} overlap")
    problems = check_chunking(chunks, CHUNK_SIZE, CHUNK_OVERLAP)
    print(f"- Structural problems: {len(problems)}")
    for problem in problems:
        print(f"  - {problem}")
    print(f"- Embed + insert: {ingest_seconds:.1f}s ({len(chunks) / ingest_seconds:.1f} chunks/s)")
    print("\n| Query | cosine | bm25 | even |")
    print("|---|---|---|---|")

    totals = {method: Totals() for method in METHODS}
    search_seconds: list[float] = []
    for topic, phrase in queries:
        relevant = relevant_ordinals(stored, phrase)

        started = time.perf_counter()
        by_cosine = search_chunks(document_id, topic, TOP_K)
        search_seconds.append(time.perf_counter() - started)

        results = {
            "cosine": score(by_cosine, relevant, TOP_K),
            "bm25": score(bm25_search(bm25, stored, topic, TOP_K), relevant, TOP_K),
            "even": score(baseline, relevant, TOP_K),
        }
        for method, s in results.items():
            totals[method].scores.append(s)
        cells = " | ".join(str(results[m].rank) if results[m].rank else "miss" for m in METHODS)
        print(f"| {topic} | {cells} |")

    print(f"\n{TOTALS_HEADER}")
    for method in METHODS:
        print(totals[method].row(method))

    return DocumentResult(len(chunks), ingest_seconds, totals, search_seconds)


# ---------------------------------------------------------------------------
# Chunk-size sweep: cosine only
# ---------------------------------------------------------------------------


def sweep_document(path: Path, queries: list[tuple[str, str]], stored_ids: list[str]) -> list[str]:
    data = path.read_bytes()
    rows = []
    for size in SWEEP_SIZES:
        overlap = size * CHUNK_OVERLAP // CHUNK_SIZE
        chunks = pdf_to_chunks(data, size, overlap)
        document_id = store_chunks(chunks)
        stored_ids.append(document_id)
        stored = list_chunks(document_id)

        totals = Totals()
        for topic, phrase in queries:
            relevant = relevant_ordinals(stored, phrase)
            if not relevant:
                continue  # A fingerprint can straddle a boundary at a small size.
            totals.scores.append(score(search_chunks(document_id, topic, TOP_K), relevant, TOP_K))

        rows.append(
            f"| {path.name} | {size} / {overlap} | {len(chunks)} | {totals.hits}/{totals.n}"
            f" ({totals.hits / totals.n:.0%}) | {totals.mean('rr'):.2f} | {totals.mean('ndcg'):.2f} |"
        )
    return rows


# ---------------------------------------------------------------------------


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(p / 100 * len(ordered)))]


def main(target: str, sweep: bool) -> None:
    path = Path(target)
    paths = sorted(path.glob("*.pdf")) if path.is_dir() else [path]
    labelled = [p for p in paths if p.name in QUERIES]
    for p in paths:
        if p not in labelled:
            print(f"(skipping {p.name}: no entry in evals/queries.py)")
    if not labelled:
        raise SystemExit("Nothing to evaluate.")

    # One connection for the whole run. Per-call connects are fine for the
    # service's two calls per upload; here they would be hundreds, and a Neon
    # connect can take seconds.
    store.shared = store._connect()

    stored_ids: list[str] = []
    try:
        results = [evaluate_document(p, QUERIES[p.name], stored_ids) for p in labelled]

        overall = {method: Totals() for method in METHODS}
        search_seconds: list[float] = []
        for result in results:
            for method in METHODS:
                overall[method].scores.extend(result.totals[method].scores)
            search_seconds.extend(result.search_seconds)

        print(f"\n## All documents ({len(results)} PDFs, {overall['cosine'].n} queries, top-{TOP_K})\n")
        print(TOTALS_HEADER)
        for method in METHODS:
            print(overall[method].row(method))

        total_chunks = sum(r.chunks for r in results)
        total_ingest = sum(r.ingest_seconds for r in results)
        print("\n### Latency\n")
        print(f"- Embed + insert: {total_chunks} chunks in {total_ingest:.1f}s ({total_chunks / total_ingest:.1f} chunks/s)")
        print(
            f"- Cosine search (embed query + pgvector round trip): p50 {percentile(search_seconds, 50) * 1000:.0f} ms,"
            f" p95 {percentile(search_seconds, 95) * 1000:.0f} ms over {len(search_seconds)} queries"
        )

        if sweep:
            print(f"\n## Chunk-size sweep (cosine, top-{TOP_K})\n")
            print(f"| Document | Size / overlap | Chunks | Hit@{TOP_K} | MRR | nDCG@{TOP_K} |")
            print("|---|---|---|---|---|---|")
            for p in labelled:
                for row in sweep_document(p, QUERIES[p.name], stored_ids):
                    print(row)
    finally:
        for document_id in stored_ids:
            delete_document(document_id)
        store.shared.close()


if __name__ == "__main__":
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(positional) != 1:
        print(__doc__)
        sys.exit(1)
    main(positional[0], sweep="--sweep" in sys.argv)
