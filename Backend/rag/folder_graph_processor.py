# ============================================================
# folder_graph_processor.py — APNJ Jarvis
# ============================================================
# Builds the folder-relationship layer: which files live in which
# folders, as an actual traversable graph rather than an implicit
# filesystem fact. Two things happen here:
#
#   1. STRUCTURAL HIERARCHY (explicit, certain — confidence 1.0)
#      Every folder and file becomes a node; 'contains' edges link
#      a folder to its immediate children (files and subfolders).
#      This is what lets a query walk "what else is in this
#      engagement's folder" or "show me sibling documents."
#
#   2. FILENAME METADATA (pattern-based, honest about its limits)
#      Version (v2, REV3, FINAL/DRAFT) and date tokens are extracted
#      via regex where the pattern is unambiguous. Client name and
#      document type are NOT guessed — there's no reliable AIS-wide
#      naming convention to pattern-match yet (see the earlier design
#      discussion: build the ruleset FROM real data first). Instead,
#      every filename's delimiter-split tokens are stored as-is, so
#      they're still available for coarse filtering without Jarvis
#      pretending to understand something it doesn't.
#
# Deliberately NOT handled here (future extensions, not bugs):
#   - In-document references ("see Appendix B") — that needs actual
#     content parsing (doc_processor's job), not filename/path
#     inspection, and is a stronger signal than co-location.
#   - Co-location as a weak relevance boost is intentionally NOT a
#     pairwise edge between every file in a folder (that's O(n^2) and
#     doesn't scale) — "siblings" are just "other children of the same
#     parent folder node," queryable via the 'contains' edges already
#     being built here. No separate edge type needed for that.
# ============================================================

import os
import re
import json
import hashlib

import provenance
import progress

# ── Config ──────────────────────────────────────────────────
CONFIG_FILE = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\studio_config.json"


def load_config():
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


cfg = load_config()

# Which folders to walk. Defaults to code_folders if watched_folders
# isn't set — but for AIS's actual proposal/SOW/tender work, add the
# real client-document root(s) here, e.g.:
#   "watched_folders": ["F:\\Clients", "F:\\Visual Code Directory\\APNJ-LLM-Studio"]
WATCHED_FOLDERS = cfg.get("watched_folders", cfg.get("code_folders", []))

EXCLUDE_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", "site-packages", "chroma_db",
    # RAGAnything's own internal working directories (rag_anything_server.py
    # is left untouched per the earlier scoping decision, but its temp
    # extraction workspaces are pure noise for Jarvis's folder graph —
    # hundreds of UUID-named folders, mostly empty, not meaningful
    # business structure).
    "mineru_output", "rag_anything_workspaces",
}

EXT_FILE_TYPE = {
    ".py": "code", ".js": "code", ".jsx": "code", ".ts": "code", ".tsx": "code",
    ".xlsx": "excel", ".xlsm": "excel",
    ".docx": "document", ".doc": "document", ".pdf": "document",
    ".md": "document", ".txt": "document",
}


# ── Filename metadata (pattern-based, honest scope) ─────────
VERSION_TOKEN_RE = re.compile(r"^v(\d+(?:\.\d+)?)$|^rev[_-]?(\d+)$", re.IGNORECASE)
STATUS_TOKEN_RE = re.compile(r"^(final|draft|archived?)$", re.IGNORECASE)
DATE_RE = re.compile(
    r"(\d{4}[-_]\d{2}[-_]\d{2})"   # 2026-01-15 / 2026_01_15
    r"|(\d{2}[-_]\d{2}[-_]\d{4})"  # 15-01-2026
    r"|(\d{8})"                    # 20260115
)


def extract_filename_metadata(filename):
    """
    Returns a dict with whatever can be confidently extracted:
    version, status, date_token — plus a generic 'tokens' list
    (filename split on _, -, spaces) as a fallback that's still
    useful for filtering even when nothing else matches.

    Version/status are matched against individual split tokens rather
    than a \\b-bounded whole-string regex — a word boundary doesn't
    fire between '_' and 'v2' (underscore counts as a word character),
    so '_v2_' or '_DRAFT' would silently fail to match otherwise, and
    underscore-delimited names are the norm here, not the exception.
    """
    stem = os.path.splitext(filename)[0]
    tokens = [t for t in re.split(r"[_\-\s]+", stem) if t]
    meta = {}

    for t in tokens:
        if "version" not in meta:
            v = VERSION_TOKEN_RE.match(t)
            if v:
                meta["version"] = v.group(1) or v.group(2)
        if "status" not in meta:
            s = STATUS_TOKEN_RE.match(t)
            if s:
                meta["status"] = s.group(1).lower()

    # Date is matched against the whole stem, not per-token — splitting
    # on '-' would shatter '2026-01-15' into three separate tokens
    # ('2026', '01', '15') before a date pattern ever got a chance.
    d = DATE_RE.search(stem)
    if d:
        meta["date_token"] = next(g for g in d.groups() if g)

    meta["tokens"] = tokens
    return meta


def guess_file_type(filename):
    ext = os.path.splitext(filename)[1].lower()
    return EXT_FILE_TYPE.get(ext, "other")


def listing_hash(dirpath, entries):
    """Hash of a folder's immediate child names — changes whenever a
    file is added, removed, or renamed, giving the folder itself a
    staleness signal even though it has no content of its own."""
    h = hashlib.sha256()
    for name in sorted(entries):
        h.update(name.encode("utf-8", errors="replace"))
    return h.hexdigest()


# ── Recursive builder ────────────────────────────────────────
def count_folders(root):
    total = 0
    for r, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        total += 1
    return total


def process_folder(folder_path, watch_root, counter=None, total=1):
    """
    Registers this folder as a node, recurses into subfolders first
    (so their node ids exist), then links every immediate child
    (files and subfolders) with a 'contains' edge. Returns this
    folder's node id, so the caller (parent folder) can link to it.
    """
    try:
        entries = os.listdir(folder_path)
    except OSError as e:
        print(f"    Could not list {folder_path}: {e}")
        return None

    subdirs = sorted(
        e for e in entries
        if os.path.isdir(os.path.join(folder_path, e))
        and e not in EXCLUDE_DIRS and not e.startswith(".")
    )
    files = sorted(
        e for e in entries
        if os.path.isfile(os.path.join(folder_path, e))
    )

    rel_path = os.path.relpath(folder_path, start=watch_root) or "."
    if counter is not None:
        counter["done"] += 1
        progress.set_progress("folder", counter["done"], total, current_file=rel_path)
    folder_file_id = provenance.upsert_folder_entry(folder_path, listing_hash(folder_path, entries))
    folder_node_id = provenance.upsert_node(
        file_id=folder_file_id, node_type="folder", identifier=f"{rel_path}::<folder>",
        display_text=f"Folder: {rel_path}", location={"path": rel_path},
        extra={"child_folder_count": len(subdirs), "child_file_count": len(files)},
    )

    child_count = 0
    for fname in files:
        fpath = os.path.join(folder_path, fname)
        file_rel = os.path.relpath(fpath, start=watch_root)
        meta = extract_filename_metadata(fname)
        child_file_id = provenance.get_or_create_file_id(fpath, default_file_type=guess_file_type(fname))
        child_node_id = provenance.upsert_node(
            file_id=child_file_id, node_type="file", identifier=f"{file_rel}::<file>",
            display_text=f"File: {fname}" + (f" (version {meta['version']})" if meta.get("version") else ""),
            location={"path": file_rel}, extra=meta,
        )
        provenance.upsert_edge(folder_node_id, child_node_id, "contains", confidence=1.0)
        child_count += 1

    for dname in subdirs:
        dpath = os.path.join(folder_path, dname)
        child_folder_node_id = process_folder(dpath, watch_root, counter=counter, total=total)
        if child_folder_node_id is not None:
            provenance.upsert_edge(folder_node_id, child_folder_node_id, "contains", confidence=1.0)
            child_count += 1

    print(f"  {rel_path}: {child_count} direct children")
    return folder_node_id


def process_all_watched_folders():
    if not WATCHED_FOLDERS:
        print("No watched_folders (or code_folders) configured in studio_config.json — nothing to scan.")
        return

    provenance.ensure_schema()
    print(f"Scanning {len(WATCHED_FOLDERS)} watched folder(s)...\n")

    total = sum(count_folders(root) for root in WATCHED_FOLDERS if os.path.isdir(root)) or 1
    counter = {"done": 0}
    for root in WATCHED_FOLDERS:
        if not os.path.isdir(root):
            print(f"  Skipping (not found): {root}")
            continue
        print(f"=== {root} ===")
        process_folder(root, watch_root=root, counter=counter, total=total)

    progress.finish_progress("folder")
    print("\nDone!")


if __name__ == "__main__":
    process_all_watched_folders()