# ============================================================
# doc_graph_processor.py — APNJ Jarvis
# ============================================================
# Parses PDF and Word (.docx) documents into the same node/edge
# pattern as Excel and code — but documents don't have formulas or
# function calls, so the "dependency" concept here is different:
#
#   NODE = a paragraph or a heading ("section")
#   EDGE 'contains'    = document -> section (structural, like code's
#                         module -> function containment)
#   EDGE 'references'  = a section that explicitly mentions another
#                         part of the SAME document ("see Section 2",
#                         "refer to Appendix A") or another FILE
#                         ("see SOW_v2.docx") — this is the in-document
#                         reference detection we deferred all the way
#                         back at the original design stage.
#
# HONEST LIMITATIONS (same spirit as the Excel/code notes):
#   - PDF text extraction has no real layout/style info (pypdf gives
#     plain text only), so heading detection in PDFs is a heuristic
#     (short line, numbered, or title-cased) — not as reliable as
#     Word's real "Heading 1" style, which IS used directly.
#   - Filename references only match a single space-free token
#     (e.g. "SOW_v2.docx"). A filename genuinely written with spaces
#     in running prose ("ROI Model.xlsx") will only partially match
#     ("Model.xlsx") — this still resolves correctly in practice via
#     the substring lookup against real file paths, just flagging it
#     as an approximation rather than a precise match.
#   - Section/Appendix references only resolve within the SAME
#     document — cross-document section references ("see Section 2
#     of the MSA") aren't attempted; that would require disambiguating
#     which document's Section 2 is meant, which is a real scope-creep
#     risk for a pattern-based approach.
# ============================================================

import os
import re
import json
import requests
import chromadb
from docx import Document as DocxDocument
from pypdf import PdfReader

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

# Reuses the same watched_folders as the folder graph — these are
# inherently the same real-world folders (client docs, SOWs, MSAs),
# no separate config key needed.
WATCHED_FOLDERS = cfg.get("watched_folders", cfg.get("code_folders", []))
CHROMA_FOLDER = cfg.get("chroma_folder", r"F:\Visual Code Directory\APNJ-LLM-Studio\data\chroma_db")
EMBED_URL = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION = "apnj_doc_graph"

EXCLUDE_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", "site-packages", "chroma_db",
    "mineru_output", "rag_anything_workspaces",
}
SUPPORTED_EXTS = {".pdf", ".docx"}

MIN_PARAGRAPH_CHARS = 20   # skip trivial fragments ("", page numbers, etc.)
PDF_LINE_MERGE_LIMIT = 400  # chars per merged block when a PDF has no blank-line paragraphs


def discover_files(folders):
    for folder in folders:
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            for fname in files:
                if os.path.splitext(fname)[1].lower() in SUPPORTED_EXTS:
                    yield os.path.join(root, fname)


# ── Reference detection patterns ────────────────────────────
FILENAME_RE = re.compile(r"\b[\w\-]+\.(?:docx?|pdf|xlsx?)\b", re.IGNORECASE)
SECTION_REF_RE = re.compile(r"\b(?:Section|Appendix|Exhibit|Schedule)\s+([A-Za-z0-9]+(?:\.\d+)*)\b")
LEADING_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)[\.\)]?\s+\S")
PDF_HEADING_HINT_RE = re.compile(r"^(?:Section\s+)?\d+(?:\.\d+)*[\.\):]?\s")


def looks_like_pdf_heading(line):
    line = line.strip()
    if not line or len(line) > 80:
        return False
    if PDF_HEADING_HINT_RE.match(line):
        return True
    # All-caps short line (e.g. "MASTER SERVICES AGREEMENT")
    letters = [c for c in line if c.isalpha()]
    if letters and all(c.isupper() for c in letters) and len(line.split()) <= 8:
        return True
    return False


def extract_heading_labels(text):
    """Every label this heading could plausibly be referenced by —
    a leading number ('1. Overview' -> '1') plus any explicit
    Section/Appendix/etc mention inside the heading text itself
    ('3. Appendix A' -> also 'A')."""
    labels = set()
    m = LEADING_NUMBER_RE.match(text.strip())
    if m:
        labels.add(m.group(1))
    for m in SECTION_REF_RE.finditer(text):
        labels.add(m.group(1))
    return labels


# ── Parsing ──────────────────────────────────────────────────
def parse_docx(filepath):
    """Returns a list of dicts: {text, is_heading, location, labels}."""
    doc = DocxDocument(filepath)
    blocks = []
    for i, p in enumerate(doc.paragraphs):
        text = p.text.strip()
        if not text:
            continue
        is_heading = p.style.name.lower().startswith("heading")
        if not is_heading and len(text) < MIN_PARAGRAPH_CHARS:
            continue
        labels = extract_heading_labels(text) if is_heading else set()
        blocks.append({
            "text": text, "is_heading": is_heading,
            "location": {"paragraph_index": i}, "labels": labels,
        })
    return blocks


def split_pdf_page(text):
    """Blank-line paragraphs if present; otherwise merge consecutive
    lines up to PDF_LINE_MERGE_LIMIT chars so a line-per-line PDF
    doesn't fragment into one node per line."""
    blank_split = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    if len(blank_split) > 1:
        return blank_split
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    blocks, current = [], []
    current_len = 0
    for line in lines:
        if current_len + len(line) > PDF_LINE_MERGE_LIMIT and current:
            blocks.append(" ".join(current))
            current, current_len = [], 0
        current.append(line)
        current_len += len(line)
    if current:
        blocks.append(" ".join(current))
    return blocks


def parse_pdf(filepath):
    reader = PdfReader(filepath)
    blocks = []
    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for block_text in split_pdf_page(text):
            if not block_text:
                continue
            is_heading = looks_like_pdf_heading(block_text)
            if not is_heading and len(block_text) < MIN_PARAGRAPH_CHARS:
                continue
            labels = extract_heading_labels(block_text) if is_heading else set()
            blocks.append({
                "text": block_text, "is_heading": is_heading,
                "location": {"page": page_num}, "labels": labels,
            })
    return blocks


# ── Embedding + Chroma ──────────────────────────────────────
def get_embedding(text):
    try:
        r = requests.post(EMBED_URL, json={"model": "nomic-embed-text-v2-moe", "input": text[:2000]}, timeout=30)
        return r.json()["data"][0]["embedding"]
    except Exception:
        return None


def get_collection():
    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    return client.get_or_create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})


def resolve_filename_reference(candidate_filename):
    """Live substring lookup against jarvis_files — no in-memory index
    needed since references only ever point at files that are (or will
    be) independently indexed and persisted."""
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM jarvis_files
                WHERE file_path ILIKE %s AND status != 'missing'
                LIMIT 5;
            """, (f"%{candidate_filename}%",))
            return [row[0] for row in cur.fetchall()]


# ── Main per-file processing ────────────────────────────────
def process_file(filepath, collection, force=False):
    rel_path = os.path.relpath(filepath, start=os.path.commonpath(WATCHED_FOLDERS)) if WATCHED_FOLDERS else os.path.basename(filepath)
    print(f"\n  Processing: {rel_path}")

    if not force and not provenance.file_needs_reindex(filepath):
        print("    Unchanged since last index — skipping. (use --force to reprocess anyway)")
        return 0

    ext = os.path.splitext(filepath)[1].lower()
    try:
        blocks = parse_docx(filepath) if ext == ".docx" else parse_pdf(filepath)
    except Exception as e:
        print(f"    Could not parse: {e}")
        return 0

    file_id = provenance.upsert_file(filepath, file_type="document")
    provenance.clear_outgoing_edges_for_file(file_id)

    module_identifier = f"{rel_path}::<document>"
    module_node_id = provenance.upsert_node(
        file_id=file_id, node_type="document", identifier=module_identifier,
        display_text=f"Document: {rel_path}", location={"path": rel_path},
        extra={"block_count": len(blocks)},
    )

    heading_map = {}   # label -> node identifier, for same-document section refs
    node_ids = {}       # identifier -> db node id
    embedded_count = 0
    embedding_failures = 0
    pending_edges = []  # (source_identifier, kind, value) where kind='label' or 'filename'

    for i, block in enumerate(blocks):
        identifier = f"{rel_path}::block{i}"
        node_type = "heading" if block["is_heading"] else "section"
        chroma_id = f"{rel_path}::block{i}"

        embedding = get_embedding(block["text"])
        if embedding is not None:
            collection.upsert(
                ids=[chroma_id], embeddings=[embedding], documents=[block["text"]],
                metadatas=[{
                    "source": rel_path, "identifier": identifier, "node_type": node_type,
                    "file_id": file_id, **{f"loc_{k}": v for k, v in block["location"].items()},
                }],
            )
            embedded_count += 1
        else:
            embedding_failures += 1

        node_id = provenance.upsert_node(
            file_id=file_id, node_type=node_type, identifier=identifier,
            display_text=block["text"][:200], raw_content=block["text"],
            location=block["location"], chroma_id=chroma_id if embedding is not None else None,
            extra={"is_heading": block["is_heading"]},
        )
        node_ids[identifier] = node_id
        provenance.upsert_edge(module_node_id, node_id, "contains", confidence=1.0)

        if block["is_heading"]:
            for label in block["labels"]:
                heading_map[label] = identifier

        for m in FILENAME_RE.finditer(block["text"]):
            pending_edges.append((identifier, "filename", m.group(0)))
        for m in SECTION_REF_RE.finditer(block["text"]):
            pending_edges.append((identifier, "label", m.group(1)))

    resolved = 0
    for source_identifier, kind, value in pending_edges:
        source_node_id = node_ids.get(source_identifier)
        if source_node_id is None:
            continue
        if kind == "label":
            target_identifier = heading_map.get(value)
            if target_identifier and target_identifier != source_identifier:
                provenance.upsert_edge(source_node_id, node_ids[target_identifier], "references", confidence=1.0)
                resolved += 1
        elif kind == "filename":
            candidate_file_ids = resolve_filename_reference(value)
            candidate_file_ids = [fid for fid in candidate_file_ids if fid != file_id]
            if candidate_file_ids:
                confidence = 1.0 if len(candidate_file_ids) == 1 else round(1.0 / len(candidate_file_ids), 2)
                for target_file_id in candidate_file_ids:
                    # Look up the target file's <document> node by its own relative path.
                    target_path = provenance.get_file_path(target_file_id)
                    if not target_path:
                        continue
                    target_rel = os.path.relpath(target_path, start=os.path.commonpath(WATCHED_FOLDERS)) if WATCHED_FOLDERS else os.path.basename(target_path)
                    target_node_id = provenance.get_node_id(target_file_id, f"{target_rel}::<document>")
                    if target_node_id:
                        provenance.upsert_edge(source_node_id, target_node_id, "references", confidence=confidence)
                        resolved += 1

    if embedding_failures > 0:
        provenance.mark_file_status(file_id, "pending")
        print(f"    {len(node_ids)} nodes, {resolved} references resolved, {embedded_count} embedded, "
              f"{embedding_failures} embedding(s) FAILED — marked 'pending' for retry")
    else:
        print(f"    {len(node_ids)} nodes, {resolved} references resolved, {embedded_count} embedded for semantic search")
    return embedded_count


def process_all_doc_files(force=False):
    if not WATCHED_FOLDERS:
        print("No watched_folders configured in studio_config.json — nothing to scan.")
        return

    provenance.ensure_schema()
    collection = get_collection()

    files = list(discover_files(WATCHED_FOLDERS))
    print(f"Found {len(files)} PDF/Word file(s) across {len(WATCHED_FOLDERS)} folder(s).")

    total_embedded = 0
    for idx, filepath in enumerate(files):
        progress.set_progress("doc", idx, len(files), current_file=os.path.basename(filepath))
        try:
            total_embedded += process_file(filepath, collection, force=force)
        except Exception as e:
            print(f"    Failed to process {filepath}: {e}")
    progress.finish_progress("doc")

    print(f"\nDone!")
    print(f"Chunks embedded: {total_embedded}")
    print(f"Total in Chroma collection: {collection.count()}")


if __name__ == "__main__":
    import sys
    force_flag = "--force" in sys.argv
    process_all_doc_files(force=force_flag)