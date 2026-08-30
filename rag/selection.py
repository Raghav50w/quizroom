"""Choosing which part of a document the questions get written from.

The two pure helpers live here so they can be tested without a database.
"""

from __future__ import annotations

from typing import Protocol, TypeVar

# Four chunks, ~12,000 characters. Five would be exactly the 15,000-character
# source cap the generator enforces, with zero headroom — sitting precisely on
# a boundary is how a confusing failure arrives later.
CHUNKS_PER_PROMPT = 4


class Ordered(Protocol):
    ordinal: int


T = TypeVar("T")
O = TypeVar("O", bound=Ordered)


def even_sample(items: list[T], count: int) -> list[T]:
    """`count` items spread evenly across `items`, keeping input order.

    This is the no-topic path, and it is honestly *not* vector search — it is
    index arithmetic that never touches pgvector. With no topic there is
    nothing to search against, so we spread the picks across the document
    rather than taking the first N. That covers the document's shape, not its
    meaning, which is why the upload form asks for a topic by default.
    """
    if count <= 0:
        return []
    if len(items) <= count:
        return list(items)

    step = len(items) / count
    # Mid-interval, not `i * step`: taking the left edge of each interval
    # always picks index 0 and never comes near the end of the document.
    return [items[int((i + 0.5) * step)] for i in range(count)]


def sort_by_ordinal(items: list[O]) -> list[O]:
    """Document order, whatever order retrieval returned them in.

    Cosine search returns by similarity, so without this the model reads
    excerpts shuffled — a conclusion before the setup that explains it.
    """
    return sorted(items, key=lambda item: item.ordinal)


def join(items: list[O]) -> str:
    return "\n\n".join(item.text for item in sort_by_ordinal(items))  # type: ignore[attr-defined]
