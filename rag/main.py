"""The RAG service.

Two endpoints rather than one, so the Node side can report which step a job
is on: extraction and embedding take seconds, and a user watching a spinner
should be told which is happening.
"""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from pdf import PdfError, pdf_to_chunks
from selection import CHUNKS_PER_PROMPT, even_sample, join
from store import list_chunks, search_chunks, store_chunks

app = FastAPI(title="quizroom-rag")


class SelectRequest(BaseModel):
    document_id: str
    topic: str | None = None


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)) -> dict[str, object]:
    try:
        chunks = pdf_to_chunks(await file.read())
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
