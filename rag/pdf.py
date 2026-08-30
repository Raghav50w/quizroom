"""PDF -> cleaned, ordinal-tagged chunks.

Pure functions. No database, no network, no model — importable and testable
on its own.

PyMuPDF gives text *blocks* with coordinates, which is the whole reason this
is not a flat-text extractor. On a two-column paper a flat text layer
interleaves figure captions into the middle of body paragraphs, and page
furniture can only be found by guessing at repetition. Coordinates make both
of those positional facts instead of heuristics.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import pymupdf

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 50

CHUNK_SIZE = 3_000
CHUNK_OVERLAP = 400

# Fractions of page height treated as furniture. Measured on a real IEEE
# paper: running header at y=27 and footer at y=753 on a 792pt page, i.e.
# 3.5% and 95%. 8% either end clears both with room to spare without
# reaching the first line of body text (y=62 on the tightest page seen).
HEADER_ZONE = 0.08
FOOTER_ZONE = 0.92

# A block wider than this fraction of the page spans both columns: a figure
# caption, a wide table, or a footer. Body text in a column measures 245pt of
# a 575pt page (43%); full-width blocks measure 498pt (87%).
FULL_WIDTH = 0.60

CAPTION_RE = re.compile(r"^(FIGURE|TABLE|Fig\.|Table)\b", re.IGNORECASE)
PAGE_NUMBER_RE = re.compile(r"^(?:page\s+)?[-–—\s]*\d+(?:\s+of\s+\d+)?[-–—\s]*$", re.IGNORECASE)


class PdfError(Exception):
    """Carries a code the client already has copy for."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    text: str


@dataclass(frozen=True)
class Block:
    x0: float
    y0: float
    x1: float
    text: str


def extract_pages(data: bytes) -> list[list[Block]]:
    """Bytes -> blocks per page, furniture already dropped by position.

    Pages stay separate because callers may want page boundaries; the text
    layer only, since a scanned PDF has none and OCR is out of scope.
    """
    if len(data) > MAX_PDF_BYTES:
        raise PdfError(
            f"PDF is {len(data) / 1024 / 1024:.1f}MB, limit is {MAX_PDF_BYTES // 1024 // 1024}MB",
            "file_too_large",
        )

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as cause:  # noqa: BLE001 - any parse failure is the same to us
        raise PdfError(f"Could not read the PDF: {cause}", "no_text_found") from cause

    with doc:
        if doc.page_count > MAX_PDF_PAGES:
            raise PdfError(
                f"PDF has {doc.page_count} pages, limit is {MAX_PDF_PAGES}", "too_many_pages"
            )

        pages = [_page_blocks(page) for page in doc]

    if not any(block.text.strip() for page in pages for block in page):
        raise PdfError("No text layer found — scanned PDFs are not supported", "no_text_found")

    return pages


def _page_blocks(page: pymupdf.Page) -> list[Block]:
    height = page.rect.height
    top, bottom = height * HEADER_ZONE, height * FOOTER_ZONE

    kept = []
    for x0, y0, x1, _y1, text, _no, _type in page.get_text("blocks"):
        if y0 < top or y0 > bottom:
            continue  # Running header or footer, by position.
        if not text.strip():
            continue
        kept.append(Block(x0=x0, y0=y0, x1=x1, text=text))
    return kept


def read_order(blocks: list[Block], page_width: float) -> tuple[list[Block], list[Block]]:
    """Two-column reading order, with captions lifted out of the body.

    Returns (body, captions).

    Two problems, one function. PyMuPDF's own `sort=True` orders by position,
    which on two columns walks across both and back, producing text that jumps
    mid-argument. And a figure caption physically sits between two halves of a
    sentence — "the AC input is first converted to 50 VDC by a" / CAPTION /
    "power supply unit (PSU)" — so leaving it inline splits the sentence
    wherever the typesetter happened to put the figure.

    So: full-width blocks act as horizontal rules dividing the page into
    bands, and within each band the left column is read top to bottom, then
    the right. Captions are collected and returned separately for the caller
    to append after the page's body, which keeps them without breaking prose.
    """
    if not blocks:
        return [], []

    midpoint = page_width / 2
    full_width_limit = page_width * FULL_WIDTH

    separators = sorted(
        (b for b in blocks if (b.x1 - b.x0) >= full_width_limit), key=lambda b: b.y0
    )
    columns = [b for b in blocks if (b.x1 - b.x0) < full_width_limit]

    body: list[Block] = []
    captions: list[Block] = []
    previous_y = float("-inf")
    for boundary in [*(s.y0 for s in separators), float("inf")]:
        band = [b for b in columns if previous_y <= b.y0 < boundary]
        left = sorted((b for b in band if b.x0 < midpoint), key=lambda b: b.y0)
        right = sorted((b for b in band if b.x0 >= midpoint), key=lambda b: b.y0)
        body.extend(left + right)

        separator = next((s for s in separators if s.y0 == boundary), None)
        if separator is not None:
            # A full-width block is a caption or a wide table. Either way it is
            # not part of the sentence it interrupts.
            captions.append(separator)
        previous_y = boundary

    # A caption can also sit in a single column, narrow enough to miss the
    # full-width test. Catch those by their label.
    labelled = [b for b in body if CAPTION_RE.match(b.text.strip())]
    if labelled:
        body = [b for b in body if b not in labelled]
        captions.extend(labelled)

    return body, captions


def clean(pages: list[list[Block]], page_width: float) -> str:
    """Blocks -> one string: body in reading order, captions after each page.

    Captions are kept rather than dropped — they carry real content — but
    they go after the page's prose, so a sentence the figure interrupted
    reads continuously.
    """
    paragraphs: list[str] = []
    for blocks in pages:
        body, captions = read_order(blocks, page_width)
        for block in [*body, *captions]:
            text = block.text.strip()
            if PAGE_NUMBER_RE.match(text):
                continue
            tidied = _tidy(text)
            if tidied:
                paragraphs.append(tidied)

    return "\n\n".join(paragraphs)


# Typeset PDFs use single-glyph ligatures. Left alone they reach the model as
# "ﬁrst" and "speciﬁcations" — words no tokeniser splits the way it would the
# ASCII spelling, which quietly degrades both retrieval and the questions.
LIGATURES = str.maketrans({"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "ft"})


def _tidy(text: str) -> str:
    text = text.translate(LIGATURES)
    # Rejoin a word broken across a line: "photo-\nsynthesis".
    # Lowercase on the right only — "State-of-the-\nArt" and "AC-\nDC" are
    # real compounds and joining them corrupts the word. On a 30-page paper
    # this caught 418 of 430 breaks; the misses are a stray hyphen, which is
    # harmless, rather than a mangled word, which is not.
    text = re.sub(r"([A-Za-z])-\n([a-z])", r"\1\2", text)
    text = re.sub(r"[ \t]*\n[ \t]*", " ", text)  # Blocks are paragraphs; unwrap them.
    return re.sub(r"\s{2,}", " ", text).strip()


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[Chunk]:
    """Fixed character windows with overlap, so a fact split across a
    boundary survives whole on at least one side.

    Characters, not tokens: a tokeniser is a dependency and a model download
    to decide where to cut a string, and the 4-chunk budget downstream has
    enough headroom that the imprecision costs nothing.
    """
    if not text.strip():
        return []

    stride = size - overlap
    chunks: list[Chunk] = []
    start = 0
    while start < len(text):
        # A trailing window shorter than the overlap is wholly inside its
        # predecessor — it would be a duplicate embedding of covered text.
        if start > 0 and len(text) - start <= overlap:
            break
        chunks.append(Chunk(ordinal=len(chunks), text=text[start : start + size]))
        start += stride

    return chunks


def pdf_to_chunks(data: bytes) -> list[Chunk]:
    """The whole pure pipeline: bytes in, chunks out."""
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        page_width = doc[0].rect.width if doc.page_count else 0.0
    return chunk_text(clean(extract_pages(data), page_width))
