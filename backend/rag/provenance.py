# ============================================================
# provenance.py — APNJ Jarvis
# ============================================================
# Shared provenance + dependency-graph layer for Jarvis.
#
# Every chunk/node Jarvis indexes carries a "source record" that
# survives the whole pipeline: parser -> chunk -> embedding ->
# graph -> retrieval -> UI "sources used" panel. This module owns
# that record and the Postgres storage behind it.
#
# WHAT THIS MODULE PROVIDES:
#   - Postgres connection + idempotent schema bootstrap
#   - File fingerprinting (content hash, not just mtime) for
#     staleness detection
#   - upsert_node / upsert_edge — the two primitives every
#     type-specific processor (Excel, code, folders...) calls
#     to write into the shared graph
#   - get_precedents / get_dependents — graph traversal used by
#     the "what does this depend on" / "what breaks if I change
#     this" queries, and by the sources panel to show related nodes
#
# Connection settings are read from jarvis_db.env (see
# SETUP_JARVIS.md for how to create the local database).
# ============================================================

import os
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras


# ── Config ──────────────────────────────────────────────────
BASE_DIR = r"F:\Visual Code Directory\APNJ-LLM-Studio"
ENV_FILE = os.path.join(BASE_DIR, "jarvis_db.env")


def _load_env(env_path):
    cfg = {}
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


_env = _load_env(ENV_FILE)

PG_HOST = _env.get("JARVIS_PG_HOST", "127.0.0.1")
PG_PORT = _env.get("JARVIS_PG_PORT", "5432")
PG_DB   = _env.get("JARVIS_PG_DB", "jarvis")
PG_USER = _env.get("JARVIS_PG_USER", "postgres")
PG_PASS = _env.get("JARVIS_PG_PASSWORD", "")

SCHEMA_FILE = os.path.join(os.path.dirname(__file__), "db_schema.sql")


# ── Connection ──────────────────────────────────────────────
def get_connection():
    """
    Open a new Postgres connection. Use as a context manager:
        with get_connection() as conn:
            ...
    Short-lived connections are intentional here — Jarvis's indexing
    is a batch/background process, not a high-frequency API, so we
    don't need a pool yet. Revisit if the Jarvis server itself starts
    calling this per-request at volume.
    """
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB,
        user=PG_USER, password=PG_PASS,
    )


def ensure_schema():
    """Idempotent — creates jarvis_files / jarvis_nodes / jarvis_edges
    if they don't already exist. Safe to call on every process startup."""
    with open(SCHEMA_FILE, encoding="utf-8") as f:
        ddl = f.read()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(ddl)
        conn.commit()


def utcnow():
    return datetime.now(timezone.utc)


# ── Fingerprinting ──────────────────────────────────────────
def file_fingerprint(filepath: str) -> str:
    """
    SHA-256 of the file's bytes. We hash content, not mtime, because
    mtime changes on copy/touch/sync without the content actually
    changing — hashing means we only treat a file as 'changed' when
    it genuinely is, which matters for the staleness warning in the
    sources panel (see file_needs_reindex).
    """
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def clear_outgoing_edges_for_file(file_id: int):
    """
    Delete every edge whose SOURCE node belongs to this file. Call this
    right before re-deriving a file's edges (e.g. on a --force reprocess,
    or any time the extraction/resolution logic changes), so stale edges
    from a prior run don't linger alongside newly corrected ones — without
    this, reprocessing only ever adds edges, never retracts ones that are
    no longer produced.

    Target-side edges (where this file is the thing being referenced, not
    the one doing the referencing) are deliberately left alone — those
    belong to whichever *other* file's parse emitted them, and clearing
    here would incorrectly wipe another file's valid edges.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM jarvis_edges
                WHERE source_node_id IN (SELECT id FROM jarvis_nodes WHERE file_id = %s);
            """, (file_id,))
        conn.commit()


# ── File registry ───────────────────────────────────────────
def _upsert_file_row(file_path: str, file_type: str, content_hash: str, mtime=None) -> int:
    """Shared insert/update logic behind upsert_file and upsert_folder_entry."""
    fp = str(Path(file_path).resolve())
    if mtime is None:
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(fp), tz=timezone.utc)
        except OSError:
            mtime = utcnow()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO jarvis_files (file_path, file_type, content_hash, last_modified, last_indexed_at, status)
                VALUES (%s, %s, %s, %s, %s, 'indexed')
                ON CONFLICT (file_path) DO UPDATE SET
                    file_type       = EXCLUDED.file_type,
                    content_hash    = EXCLUDED.content_hash,
                    last_modified   = EXCLUDED.last_modified,
                    last_indexed_at = EXCLUDED.last_indexed_at,
                    status          = 'indexed'
                RETURNING id;
            """, (fp, file_type, content_hash, mtime, utcnow()))
            row_id = cur.fetchone()[0]
        conn.commit()
    return row_id


def upsert_file(filepath: str, file_type: str) -> int:
    """
    Register/update a file in jarvis_files and return its DB id.
    Call this once per file at the start of processing it — every
    node created afterwards references this file_id.
    """
    return _upsert_file_row(filepath, file_type, file_fingerprint(filepath))


def upsert_folder_entry(folder_path: str, listing_hash: str) -> int:
    """
    Same idea as upsert_file, but for a folder. Folders can't be hashed
    as bytes, so the caller passes a hash of the folder's immediate
    child listing instead — this still gives the folder graph a real
    staleness signal (a file being added/removed changes the hash) using
    the same jarvis_files table, rather than a parallel schema.
    """
    return _upsert_file_row(folder_path, "folder", listing_hash)


def get_or_create_file_id(filepath: str, default_file_type: str = "other") -> int:
    """
    Look up an existing jarvis_files row by path; create one with
    default_file_type if it doesn't exist yet. Unlike upsert_file, this
    NEVER overwrites file_type or content_hash on a row that already
    exists — used by the folder processor, which walks every file for
    structural placement but shouldn't clobber metadata that a more
    specific processor (Excel, code) already established for that file.
    """
    fp = str(Path(filepath).resolve())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM jarvis_files WHERE file_path = %s;", (fp,))
            row = cur.fetchone()
            if row:
                return row[0]
            try:
                mtime = datetime.fromtimestamp(os.path.getmtime(fp), tz=timezone.utc)
            except OSError:
                mtime = utcnow()
            cur.execute("""
                INSERT INTO jarvis_files (file_path, file_type, last_modified, last_indexed_at, status)
                VALUES (%s, %s, %s, %s, 'indexed')
                RETURNING id;
            """, (fp, default_file_type, mtime, utcnow()))
            new_id = cur.fetchone()[0]
        conn.commit()
    return new_id


def file_needs_reindex(filepath: str) -> bool:
    """
    True if the file is new, or its current content hash no longer
    matches what's stored. This is the check the watcher (and a
    manual 'rescan' button) should run before doing the expensive
    parse+embed work — skip files that haven't actually changed.
    """
    fp = str(Path(filepath).resolve())
    current_hash = file_fingerprint(fp)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT content_hash FROM jarvis_files WHERE file_path = %s", (fp,))
            row = cur.fetchone()
    return row is None or row[0] != current_hash


def mark_file_missing(filepath: str):
    """
    Soft-delete: flag a file as missing rather than deleting its rows
    outright. A temporarily unmounted drive shouldn't wipe the index —
    see the scoping/watcher discussion on deletions.
    """
    fp = str(Path(filepath).resolve())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE jarvis_files SET status = 'missing' WHERE file_path = %s", (fp,))
        conn.commit()


def mark_file_status(file_id: int, status: str):
    """
    Set a file's status directly — used by processors to flag 'pending'
    when the graph/nodes were written successfully but embedding calls
    failed partway through (e.g. the embedding server was down). This
    is the actual fix for the gap we hit manually with --force earlier:
    a file marked 'pending' is visibly incomplete rather than silently
    indistinguishable from a fully-processed one, and the watcher can
    find and retry exactly these files once the embedding server is
    back, without reprocessing everything else.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE jarvis_files SET status = %s WHERE id = %s", (status, file_id))
        conn.commit()


def get_pending_files():
    """Files whose graph/nodes are current but whose embeddings are
    incomplete — candidates for a targeted retry once the embedding
    server is confirmed reachable."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, file_path, file_type FROM jarvis_files WHERE status = 'pending';")
            return cur.fetchall()


# ── Node / edge upserts (shared by every type-specific processor) ─
def upsert_node(file_id: int, node_type: str, identifier: str,
                 display_text: str = None, raw_content: str = None,
                 location: dict = None, chroma_id: str = None,
                 extra: dict = None) -> int:
    """
    Create or update a node — a cell, a function, a paragraph, a folder.
    `identifier` must be unique within the file, e.g. 'Pricing!C2' or
    'utils.py::process_data'. Returns the node's DB id, which callers
    use to build edges.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO jarvis_nodes
                    (file_id, node_type, identifier, display_text, raw_content, location, chroma_id, extra)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (file_id, identifier) DO UPDATE SET
                    node_type    = EXCLUDED.node_type,
                    display_text = EXCLUDED.display_text,
                    raw_content  = EXCLUDED.raw_content,
                    location     = EXCLUDED.location,
                    chroma_id    = EXCLUDED.chroma_id,
                    extra        = EXCLUDED.extra
                RETURNING id;
            """, (
                file_id, node_type, identifier, display_text, raw_content,
                json.dumps(location) if location is not None else None,
                chroma_id,
                json.dumps(extra) if extra is not None else None,
            ))
            node_id = cur.fetchone()[0]
        conn.commit()
    return node_id


def upsert_edge(source_node_id: int, target_node_id: int, edge_type: str, confidence: float = 1.0):
    """
    Create a directed edge source -> target, e.g. 'C2 depends_on A2'.
    Idempotent — re-running on an unchanged file just re-asserts the
    same edges (UNIQUE constraint absorbs duplicates).
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO jarvis_edges (source_node_id, target_node_id, edge_type, confidence)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (source_node_id, target_node_id, edge_type) DO UPDATE SET
                    confidence = EXCLUDED.confidence;
            """, (source_node_id, target_node_id, edge_type, confidence))
        conn.commit()


def get_file_path(file_id: int):
    """Resolve a file's absolute path from its id — used by the Open
    endpoint so the browser only ever needs to know a file_id, never
    a raw filesystem path."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT file_path FROM jarvis_files WHERE id = %s;", (file_id,))
            row = cur.fetchone()
    return row[0] if row else None


def get_node_id(file_id: int, identifier: str):
    """Look up an existing node's DB id without creating it. None if not found."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM jarvis_nodes WHERE file_id = %s AND identifier = %s",
                (file_id, identifier)
            )
            row = cur.fetchone()
    return row[0] if row else None


# ── Graph traversal — for "what depends on this" / sources panel ──
def get_precedents(file_id: int, identifier: str, max_hops: int = 1):
    """What does this node depend on? (backward traversal)."""
    return _traverse(file_id, identifier, direction="precedents", max_hops=max_hops)


def get_dependents(file_id: int, identifier: str, max_hops: int = 1):
    """What depends on this node? (forward traversal — 'what breaks if I change this')."""
    return _traverse(file_id, identifier, direction="dependents", max_hops=max_hops)


def _traverse(file_id: int, identifier: str, direction: str, max_hops: int):
    node_id = get_node_id(file_id, identifier)
    if node_id is None:
        return []

    # An edge (source, target, 'depends_on') means source's formula references target.
    # precedents ("what does this depend on"): start at source == node, walk to target.
    # dependents  ("what depends on this"):    start at target == node, walk to source.
    col_from, col_to = ("source_node_id", "target_node_id") if direction == "precedents" \
        else ("target_node_id", "source_node_id")

    seen = {node_id}
    frontier = [node_id]
    results = []

    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for _ in range(max_hops):
                if not frontier:
                    break
                cur.execute(f"""
                    SELECT e.edge_type, e.confidence,
                           n.id, n.identifier, n.node_type, n.display_text, n.location, n.chroma_id
                    FROM jarvis_edges e
                    JOIN jarvis_nodes n ON n.id = e.{col_to}
                    WHERE e.{col_from} = ANY(%s);
                """, (frontier,))
                rows = cur.fetchall()
                frontier = []
                for r in rows:
                    if r["id"] not in seen:
                        seen.add(r["id"])
                        frontier.append(r["id"])
                        results.append(dict(r))
    return results


if __name__ == "__main__":
    # Quick manual check: `python provenance.py` bootstraps the schema
    # and confirms the connection works.
    ensure_schema()
    print(f"Jarvis schema ready on {PG_HOST}:{PG_PORT}/{PG_DB}")