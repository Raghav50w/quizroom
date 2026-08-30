"""Chunks in and out of Postgres.

Raw SQL on purpose. The Drizzle schema in src/server/db/schema.ts owns the
DDL so `npm run db:push` still manages every table in one place; this module
only reads and writes rows.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

import psycopg
from pgvector.psycopg import register_vector

from embed import DIMENSIONS, embed
from pdf import Chunk

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


@dataclass(frozen=True)
class StoredChunk:
    ordinal: int
    text: str


def _id(length: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def _connect() -> psycopg.Connection:
    url = os.environ["DATABASE_URL"]
    connection = psycopg.connect(url)
    register_vector(connection)  # Or vectors come back as strings.
    return connection


def store_chunks(chunks: list[Chunk]) -> str:
    """Embeds and stores a document's chunks, returning its id.

    There is no `documents` table. It would hold a filename and a page count
    that nothing would ever read. Retrieval scopes by document because chunks
    exist before a quiz does — the quiz id is only minted at save time.

    One statement: a half-stored document answers queries with a silent
    subset of itself, which reads as bad retrieval rather than as a failure.
    """
    document_id = _id(12)
    vectors = embed([chunk.text for chunk in chunks])

    with _connect() as connection, connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO chunks (id, document_id, ordinal, text, embedding)"
            " VALUES (%s, %s, %s, %s, %s)",
            [
                (_id(16), document_id, chunk.ordinal, chunk.text, vector)
                for chunk, vector in zip(chunks, vectors, strict=True)
            ],
        )

    return document_id


def list_chunks(document_id: str) -> list[StoredChunk]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT ordinal, text FROM chunks WHERE document_id = %s ORDER BY ordinal",
            (document_id,),
        )
        return [StoredChunk(ordinal=row[0], text=row[1]) for row in cursor.fetchall()]


def search_chunks(document_id: str, query: str, limit: int) -> list[StoredChunk]:
    """Cosine nearest neighbours within one document.

    No index, deliberately. Not the ANN index — IVFFlat on a few hundred rows
    costs recall and buys nothing — and not one on document_id either. This
    was measured: EXPLAIN ANALYZE over 159 rows ran in 0.470 ms on a
    sequential scan.
    """
    [vector] = embed([query])
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT ordinal, text FROM chunks WHERE document_id = %s"
            " ORDER BY embedding <=> %s::vector LIMIT %s",
            (document_id, vector, limit),
        )
        return [StoredChunk(ordinal=row[0], text=row[1]) for row in cursor.fetchall()]


assert DIMENSIONS == 384, "schema column is vector(384)"
