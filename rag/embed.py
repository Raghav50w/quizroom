"""Text -> 384-dimension vectors, computed locally.

No API key, no quota, no rate limit, no retry ladder. That absence is the
point: the equivalent hosted-embedding code needed batching, a 429 ladder and
a minute-scale backoff purely because the provider was remote and metered.

The model is loaded once at import. Loading per request would add ten seconds
to every upload.
"""

from __future__ import annotations

from fastembed import TextEmbedding

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# Pinned, and not configurable. Must match `chunks.embedding` in the Drizzle
# schema — if they drift, the failure is a database error after embedding the
# whole document.
DIMENSIONS = 384

# Measured, not guessed. Embedding 53 chunks in one call peaks at 366MB RSS;
# in batches of 8 it peaks at 239MB against a 193MB idle baseline. Render's
# free tier is 512MB and Node needs its share, so the batch size is what keeps
# this deployable rather than a throughput knob.
BATCH_SIZE = 8

_model = TextEmbedding(model_name=MODEL_NAME)


def embed(texts: list[str]) -> list[list[float]]:
    """One vector per input, in input order."""
    if not texts:
        return []

    vectors: list[list[float]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        vectors.extend([v.tolist() for v in _model.embed(batch)])

    if len(vectors) != len(texts):
        raise ValueError(f"Expected {len(texts)} embeddings, got {len(vectors)}")
    for position, vector in enumerate(vectors):
        # Storing a wrong-length vector fails at the database with a far less
        # obvious error than this one.
        if len(vector) != DIMENSIONS:
            raise ValueError(
                f"Embedding {position} has {len(vector)} dimensions, expected {DIMENSIONS}"
            )

    return vectors
