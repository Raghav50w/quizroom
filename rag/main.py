"""The RAG service.

Two endpoints rather than one, so the Node side can report which step a job
is on: extraction and embedding take seconds, and a user watching a spinner
should be told which is happening.
"""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from pdf import PdfError, pdf_to_chunks
from store import StoredChunk, list_chunks, search_chunks, store_chunks

app = FastAPI(title="quizroom-rag")

# Four chunks, ~12,000 characters. Five would be exactly the 15,000-character
# source cap the generator enforces, with zero headroom — sitting precisely on
# a boundary is how a confusing failure arrives later.
CHUNKS_PER_PROMPT = 4


def even_sample(items: list[StoredChunk], count: int) -> list[StoredChunk]:
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


def join(items: list[StoredChunk]) -> str:
    """Document order, whatever order retrieval returned them in.

    Cosine search returns by similarity, so without this the model reads
    excerpts shuffled — a conclusion before the setup that explains it.
    """
    ordered = sorted(items, key=lambda item: item.ordinal)
    return "\n\n".join(item.text for item in ordered)


class SelectRequest(BaseModel):
    document_id: str
    topic: str | None = None


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/ingest")
def ingest(file: UploadFile = File(...)) -> dict[str, object]:
    """Defined with `def`, not `async def`, and that is load-bearing.

    Everything below blocks: PyMuPDF parsing, ONNX inference, and a synchronous
    database insert. In an `async def` handler that work runs on the event loop
    and stalls every other request on the process — including the health check —
    until it finishes. FastAPI runs a sync handler in a threadpool instead, so
    uploads overlap the way a caller expects.
    """
    try:
        chunks = pdf_to_chunks(file.file.read())
    except PdfError as error:
        # The code travels to the client, which has copy for each one.
        raise HTTPException(status_code=422, detail=error.code) from error

    if not chunks:
        raise HTTPException(status_code=422, detail="no_text_found")

    return {"document_id": store_chunks(chunks), "chunks": len(chunks)}


@app.post("/select")
def select(request: SelectRequest) -> dict[str, str]:
    """Topic given: cosine search. No topic: even sampling.

    Both paths return the same shape, so the caller never branches.
    """
    topic = (request.topic or "").strip()
    if topic:
        rows = search_chunks(request.document_id, topic, CHUNKS_PER_PROMPT)
    else:
        rows = even_sample(list_chunks(request.document_id), CHUNKS_PER_PROMPT)

    if not rows:
        raise HTTPException(status_code=404, detail="unknown_document")

    return {"source": join(rows)}
