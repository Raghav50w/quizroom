"""Retrieval eval: does cosine search find the right passage?

    python rag/eval.py path/to/document.pdf

Needs DATABASE_URL in the environment (same as the service). No LLM calls.

Each query below names a topic a user might type, paired with a phrase that
only appears in the passage that answers it. A retrieval "hit" means the
phrase is inside one of the top-k chunks returned. The same queries are run
against the no-topic path (even sampling across the document) as a baseline,
so the number reported is search *versus doing nothing*, not search in a vacuum.

Labelled for State-of-the-Art_Power_Electronics_in_AI_Data_Centers.pdf. For a
different PDF, replace QUERIES with topic -> phrase pairs from that document.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pdf import CHUNK_OVERLAP, CHUNK_SIZE, pdf_to_chunks
from store import StoredChunk, list_chunks, search_chunks, store_chunks

TOP_K = 4  # Same as CHUNKS_PER_PROMPT in main.py.

# (what a user would type in the focus box, a phrase found only in the right passage)
QUERIES = [
    ("how fast is AI compute power growing", "3.4 months"),
    ("solid-state transformers connecting to the utility grid", "solid-state transformers"),
    ("temperature of PFC stage components under full load", "PFC HF leg"),
    ("rack power where PSU-based distribution becomes impractical", "200 kW rack loads"),
    ("using 650 V GaN devices on the primary side", "half of the total bus voltage"),
    ("peak efficiency of LLC converters around 1.2 to 1.6 kW", "98.3% Pk"),
    ("advantages of matrix transformer design", "matrix transformer"),
    ("output voltage and current range of voltage regulator modules", "0.6-1.8 V"),
    ("how the trans-inductor voltage regulator works", "IP-TLVR combines"),
    ("transient recovery time of multiphase buck converters", "50 µs"),
    ("highest reported power density at 1 MHz", "3500 W/in3"),
    ("two-stage resonant switched-capacitor converter structure", "2:1 resonant SC front end"),
    ("why GaN devices have low on-resistance", "two-dimensional electron gas"),
    ("price range of SiC MOSFETs", "$5 to over $130"),
    ("limits on scaling conventional AC power supply units", "copper usage"),
]


def even_sample(items: list[StoredChunk], count: int) -> list[StoredChunk]:
    """Copy of the no-topic path in main.py, so the baseline is exactly what ships."""
    if len(items) <= count:
        return list(items)
    step = len(items) / count
    return [items[int((i + 0.5) * step)] for i in range(count)]


def contains(chunks: list[StoredChunk], phrase: str) -> int | None:
    """1-based rank of the first chunk containing the phrase, or None."""
    needle = phrase.lower()
    for rank, chunk in enumerate(chunks, start=1):
        if needle in chunk.text.lower():
            return rank
    return None


def check_chunking(text_chunks) -> list[str]:
    """Structural sanity on the chunker, reported as a list of problems."""
    problems = []
    if not text_chunks:
        return ["no chunks produced"]
    for chunk in text_chunks:
        if not chunk.text.strip():
            problems.append(f"chunk {chunk.ordinal} is empty")
        if len(chunk.text) > CHUNK_SIZE:
            problems.append(f"chunk {chunk.ordinal} is {len(chunk.text)} chars, over {CHUNK_SIZE}")
    for previous, current in zip(text_chunks, text_chunks[1:]):
        if current.text[:CHUNK_OVERLAP] != previous.text[-CHUNK_OVERLAP:]:
            problems.append(f"chunks {previous.ordinal}->{current.ordinal} do not overlap by {CHUNK_OVERLAP}")
    return problems


def main(pdf_path: str) -> None:
    data = Path(pdf_path).read_bytes()
    chunks = pdf_to_chunks(data)
    print(f"## Chunking: {Path(pdf_path).name}\n")
    print(f"- {len(data) / 1024 / 1024:.1f} MB -> {len(chunks)} chunks of {CHUNK_SIZE} chars, {CHUNK_OVERLAP} overlap")
    problems = check_chunking(chunks)
    print(f"- Structural problems: {len(problems)}")
    for problem in problems:
        print(f"  - {problem}")

    document_id = store_chunks(chunks)
    stored = list_chunks(document_id)
    baseline = even_sample(stored, TOP_K)

    # Every label must exist somewhere in the document, or the eval is broken.
    full_text = "\n".join(c.text for c in stored).lower()
    bad_labels = [phrase for _, phrase in QUERIES if phrase.lower() not in full_text]
    if bad_labels:
        print(f"\nLabel error: these phrases are not in the document: {bad_labels}")
        return

    print(f"\n## Retrieval (top-{TOP_K}, {len(QUERIES)} labelled queries)\n")
    print("| Query | Cosine search rank | In even sample? |")
    print("|---|---|---|")

    hits = 0
    reciprocal_ranks = 0.0
    baseline_hits = 0
    for topic, phrase in QUERIES:
        retrieved = search_chunks(document_id, topic, TOP_K)
        rank = contains(retrieved, phrase)
        in_baseline = contains(baseline, phrase) is not None
        if rank is not None:
            hits += 1
            reciprocal_ranks += 1 / rank
        if in_baseline:
            baseline_hits += 1
        print(f"| {topic} | {rank if rank else 'miss'} | {'yes' if in_baseline else 'no'} |")

    n = len(QUERIES)
    print("\n### Totals\n")
    print(f"- Hit rate@{TOP_K}, cosine search: {hits}/{n} ({hits / n:.0%})")
    print(f"- Hit rate@{TOP_K}, even-sample baseline: {baseline_hits}/{n} ({baseline_hits / n:.0%})")
    print(f"- MRR, cosine search: {reciprocal_ranks / n:.2f}")
    print(f"- Chunks searched per query: {len(stored)}; chunks sent to the model: {TOP_K}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
