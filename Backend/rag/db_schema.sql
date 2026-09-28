-- ============================================================
-- db_schema.sql — APNJ Jarvis
-- ============================================================
-- Local Postgres schema for Jarvis's provenance + dependency graph.
-- Separate from ChromaDB (which holds vectors/embeddings) and
-- separate from the CFO Tower's Supabase project — this is a
-- fresh, fully local database dedicated to Jarvis.
--
-- Three tables:
--   jarvis_files  — one row per indexed source file (fingerprint,
--                   staleness tracking)
--   jarvis_nodes  — one row per addressable unit inside a file
--                   (an Excel cell, a code function, a folder, ...)
--   jarvis_edges  — directed relationships between nodes
--                   (depends_on, calls, imports, contains, ...)
--
-- Run once against a fresh local database:
--   psql -U postgres -d jarvis -f db_schema.sql
-- Or call provenance.ensure_schema() from Python, which runs this
-- file idempotently on every server startup.
-- ============================================================

CREATE TABLE IF NOT EXISTS jarvis_files (
    id               SERIAL PRIMARY KEY,
    file_path        TEXT UNIQUE NOT NULL,
    file_type        TEXT NOT NULL,           -- excel | code | docx | pdf | folder
    content_hash     TEXT,                    -- sha256 of file bytes, for staleness detection
    last_modified    TIMESTAMPTZ,             -- OS mtime
    last_indexed_at  TIMESTAMPTZ,
    status           TEXT DEFAULT 'indexed'   -- indexed | pending | stale | missing
);

CREATE TABLE IF NOT EXISTS jarvis_nodes (
    id              SERIAL PRIMARY KEY,
    file_id         INTEGER NOT NULL REFERENCES jarvis_files(id) ON DELETE CASCADE,
    node_type       TEXT NOT NULL,            -- cell | cell_range | function | class | paragraph | folder
    identifier      TEXT NOT NULL,            -- e.g. 'Pricing!C2', 'utils.py::process_data'
    display_text    TEXT,                     -- human-readable description (what this node IS)
    raw_content     TEXT,                     -- formula string / code snippet / paragraph text
    location        JSONB,                    -- {"sheet": "Pricing", "cell": "C2"} or {"line_start": 10, "line_end": 24}
    chroma_id       TEXT,                     -- links to the ChromaDB chunk, if this node was embedded
    extra           JSONB,                    -- formula text, computed value, function signature, etc.
    UNIQUE (file_id, identifier)
);

CREATE TABLE IF NOT EXISTS jarvis_edges (
    id               SERIAL PRIMARY KEY,
    source_node_id   INTEGER NOT NULL REFERENCES jarvis_nodes(id) ON DELETE CASCADE,
    target_node_id   INTEGER NOT NULL REFERENCES jarvis_nodes(id) ON DELETE CASCADE,
    edge_type        TEXT NOT NULL,           -- depends_on | depends_on_range | calls | imports | contains | co_located | references
    confidence       REAL DEFAULT 1.0,        -- 1.0 = explicit/certain, lower = inferred (e.g. folder co-location)
    UNIQUE (source_node_id, target_node_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_jarvis_nodes_file     ON jarvis_nodes(file_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_edges_source   ON jarvis_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_edges_target   ON jarvis_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_jarvis_files_status   ON jarvis_files(status);
