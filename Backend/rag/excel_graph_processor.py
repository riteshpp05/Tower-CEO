# ============================================================
# excel_graph_processor.py — APNJ Jarvis
# ============================================================
# Replaces the old excel_processor.py.
#
# WHAT CHANGED FROM THE OLD VERSION:
#   Old: pandas.read_excel() reads computed VALUES only — formulas
#        are invisible to pandas. Every row got flattened into one
#        text blob ("File: X | Sheet: Y | Item: Z | Cost: ...").
#        No formula, no cell reference, no dependency graph.
#
#   New: openpyxl reads the workbook twice — once for formula
#        strings (data_only=False), once for last-computed values
#        (data_only=True) — so every formula cell becomes its own
#        addressable node with:
#          - its exact cell reference (e.g. Pricing!C2)
#          - its formula text
#          - its last-known computed value
#          - edges to every cell it depends on (precedents)
#        Cells referenced by a formula but not otherwise "meaningful"
#        (no label) still get a minimal node, so every edge resolves
#        to a real node — no dangling references.
#
# Every node is written to TWO places, kept in sync by node identifier:
#   - Postgres (jarvis_files / jarvis_nodes / jarvis_edges) — the
#     dependency graph: "what does this depend on / what depends on this"
#   - ChromaDB (apnj_excel_v2 collection) — semantic search, so a
#     query like "where's the discount calculation" can find the cell
#     without knowing its reference. Only "meaningful" cells (formulas,
#     labeled values) are embedded — pure blank/structural cells are
#     graph-only, keeping embedding volume sane.
#
# Every embedded chunk's metadata carries exact provenance (file,
# sheet, cell) so the sources panel can point back to the precise
# cell, not just "somewhere in this file".
# ============================================================

import os
import re
import json
import datetime
import requests
import chromadb
import openpyxl
from openpyxl.worksheet.formula import ArrayFormula

import provenance
import progress

# ── Config (same pattern as the rest of the codebase) ─────────
CONFIG_FILE = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\studio_config.json"


def load_config():
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


cfg = load_config()
BASE_DIR = r"F:\Visual Code Directory\APNJ-LLM-Studio"

# Unified with every other processor — one list of roots, scanned
# recursively. Falls back to the old excel_folder/uploaded_excels
# default so a fresh install (or a config file from before this
# unification) still finds something without manual editing.
_default_excel_dir = os.path.join(BASE_DIR, "data", "uploaded_excels")
WATCHED_FOLDERS = cfg.get("watched_folders") or [cfg.get("excel_folder", _default_excel_dir)]
CHROMA_FOLDER = cfg.get("chroma_folder", os.path.join(BASE_DIR, "data", "chroma_db"))

EXCLUDE_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", "site-packages", "chroma_db",
    "mineru_output", "rag_anything_workspaces",
}

EMBED_URL  = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION = "apnj_excel_v2"   # new collection — old apnj_excel left untouched during cutover
SUPPORTED  = (".xlsx", ".xlsm")

# Cells with fewer than this in a range get expanded into individual
# dependency edges (=SUM(A1:A5) -> 5 edges). Larger ranges are kept
# as a single aggregate edge instead of exploding the graph.
MAX_RANGE_EXPAND = 30

# Skip sheets that are pure UI/navigation, not data (same idea as the
# old SKIP_SHEETS list — adjust freely per workbook).
SKIP_SHEETS = {"Main Menu"}


def discover_files(folders):
    for folder in folders:
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            for fname in files:
                if fname.lower().endswith(SUPPORTED):
                    yield os.path.join(root, fname)


# ── Formula parsing ─────────────────────────────────────────
# Matches an optional sheet prefix (quoted 'My Sheet'! or bare Sheet!),
# then a column+row reference, optionally extended into a range (A1:B10).
CELL_REF_RE = re.compile(
    r"(?:'([^']+)'!|([A-Za-z_][A-Za-z0-9_. ]*)!)?"
    r"\$?([A-Z]{1,3})\$?([0-9]{1,7})"
    r"(?::\$?([A-Z]{1,3})\$?([0-9]{1,7}))?"
)


def _strip_string_literals(formula: str) -> str:
    """Remove quoted text (e.g. ="Category A1") before scanning for cell
    refs, so string contents that happen to look like a cell ref don't
    get picked up as a false dependency."""
    return re.sub(r'"[^"]*"', '""', formula)


def extract_refs(formula: str, current_sheet: str):
    """
    Return a list of dicts describing every cell/range this formula
    references, e.g.:
      [{"sheet": "Pricing", "cell": "A2"}]
      [{"sheet": "Pricing", "range_start": "C2", "range_end": "C2"}]
    Refs without an explicit sheet prefix are resolved to current_sheet.
    """
    refs = []
    cleaned = _strip_string_literals(formula)
    for m in CELL_REF_RE.finditer(cleaned):
        sheet = m.group(1) or m.group(2) or current_sheet
        col1, row1 = m.group(3), m.group(4)
        col2, row2 = m.group(5), m.group(6)
        if col2 and row2:
            refs.append({"sheet": sheet, "range_start": f"{col1}{row1}", "range_end": f"{col2}{row2}"})
        else:
            refs.append({"sheet": sheet, "cell": f"{col1}{row1}"})
    return refs


def _col_to_num(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n


def _num_to_col(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def expand_range(range_start: str, range_end: str, max_cells: int = MAX_RANGE_EXPAND):
    """
    Turn 'A1'..'B3' into individual cell refs, e.g. ['A1','A2','A3','B1','B2','B3'].
    Returns None if the range is larger than max_cells — caller should
    fall back to a single aggregate edge in that case rather than
    exploding the graph.
    """
    col1, row1 = re.match(r"([A-Z]+)([0-9]+)", range_start).groups()
    col2, row2 = re.match(r"([A-Z]+)([0-9]+)", range_end).groups()
    c1, c2 = _col_to_num(col1), _col_to_num(col2)
    r1, r2 = int(row1), int(row2)
    if (c2 - c1 + 1) * (r2 - r1 + 1) > max_cells:
        return None
    cells = []
    for c in range(min(c1, c2), max(c1, c2) + 1):
        for r in range(min(r1, r2), max(r1, r2) + 1):
            cells.append(f"{_num_to_col(c)}{r}")
    return cells


# ── Description generation (template-based, no LLM call) ──────
# Deliberately not calling the chat LLM per-cell here — on a shared
# 8GB-VRAM box, generating descriptions for thousands of cells via
# the LLM would be slow and would contend with interactive chat (see
# the VRAM/orchestration discussion). Template descriptions are
# instant and good enough for semantic search; swap in an LLM call
# later as an off-hours batch pass if template quality proves
# insufficient — the node schema doesn't need to change either way.
def describe_cell(sheet_name, cell_ref, formula, computed_value, nearby_label):
    label_part = f" (near label: '{nearby_label}')" if nearby_label else ""
    if formula:
        return f"Cell {cell_ref} on sheet '{sheet_name}' computes: {formula}. Last value: {computed_value}.{label_part}"
    return f"Cell {cell_ref} on sheet '{sheet_name}' has value: {computed_value}.{label_part}"


def find_nearby_label(ws, cell, max_look=6):
    """
    Look further and wider for context than the immediate neighbor.
    Financial models routinely put a row's label two or three columns to
    the left of its data (with blank spacer cells in between), and column
    headers are often a few rows above the data, not always row 1 (title
    rows, section headers, merged multi-row headers). This scans up to
    `max_look` cells in each direction for the nearest text, and combines
    a row label with a column header when both are found — e.g. a value
    under a 'Q3 2026' column header in a 'Discount Rate' row becomes
    'Discount Rate / Q3 2026', which is far more useful for semantic
    search than either alone.
    """
    row, col = cell.row, cell.column

    row_label = None
    for offset in range(1, max_look + 1):
        c = col - offset
        if c < 1:
            break
        v = ws.cell(row=row, column=c).value
        if isinstance(v, str) and len(v.strip()) > 1 and not v.strip().startswith("="):
            row_label = v.strip()
            break

    col_label = None
    for offset in range(1, max_look + 1):
        r = row - offset
        if r < 1:
            break
        v = ws.cell(row=r, column=col).value
        if isinstance(v, str) and len(v.strip()) > 1 and not v.strip().startswith("="):
            col_label = v.strip()
            break

    if row_label and col_label and row_label != col_label:
        return f"{row_label} / {col_label}"
    return row_label or col_label


def _json_safe(value):
    """
    Coerce an Excel cell value into something json.dumps can handle.
    openpyxl returns plain Python types (str, int, float, bool, None) for
    most cells, but datetime.datetime/date for date-formatted cells and
    an ArrayFormula object for dynamic array ("spill") formulas — neither
    is JSON serializable as-is. Everything else falls back to str().
    """
    if isinstance(value, ArrayFormula):
        return value.text
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


# ── Embedding + Chroma ──────────────────────────────────────
def get_embedding(text):
    try:
        r = requests.post(
            EMBED_URL,
            json={"model": "nomic-embed-text-v2-moe", "input": text[:2000]},
            timeout=30,
        )
        return r.json()["data"][0]["embedding"]
    except Exception as e:
        print(f"    Embedding failed: {e}")
        return None


# ── Main per-file processing ────────────────────────────────
def process_file(filepath, rel_path, collection, force=False):
    print(f"\n  Processing: {rel_path}")

    if not force and not provenance.file_needs_reindex(filepath):
        print(f"    Unchanged since last index — skipping. (use --force to reprocess anyway)")
        return 0

    file_id = provenance.upsert_file(filepath, file_type="excel")
    provenance.clear_outgoing_edges_for_file(file_id)

    wb_formulas = openpyxl.load_workbook(filepath, data_only=False)
    wb_values   = openpyxl.load_workbook(filepath, data_only=True)

    node_ids = {}   # identifier -> db node id, for resolving edges after all nodes exist
    pending_edges = []   # (source_identifier, target_identifier, edge_type)
    embedded_count = 0
    embedding_failures = 0

    for ws_f in wb_formulas.worksheets:
        sheet_name = ws_f.title
        if sheet_name in SKIP_SHEETS:
            print(f"    Skipping sheet: {sheet_name}")
            continue
        ws_v = wb_values[sheet_name]

        for row in ws_f.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue

                identifier = f"{sheet_name}!{cell.coordinate}"
                is_array_formula = isinstance(cell.value, ArrayFormula)
                is_plain_formula = isinstance(cell.value, str) and cell.value.startswith("=")
                is_formula = is_plain_formula or is_array_formula
                formula_text = cell.value.text if is_array_formula else (cell.value if is_plain_formula else None)
                computed_value = _json_safe(ws_v[cell.coordinate].value) if is_formula else _json_safe(cell.value)

                # Only formula cells or cells with a nearby text label are
                # "meaningful" enough to embed for semantic search. Plain
                # unlabeled values still become a graph node further below
                # if something references them, but aren't embedded.
                nearby_label = find_nearby_label(ws_f, cell)
                is_meaningful = is_formula or (nearby_label is not None and not isinstance(cell.value, str))

                if not is_formula and not is_meaningful:
                    continue

                if (len(node_ids) + 1) % 25 == 0:
                    print(f"    ...{len(node_ids) + 1} cells processed so far ({embedded_count} embedded)")

                display_text = describe_cell(sheet_name, cell.coordinate, formula_text, computed_value, nearby_label)

                chroma_id = None
                if is_meaningful:
                    chroma_id = f"{rel_path}::{sheet_name}::{cell.coordinate}"
                    embedding = get_embedding(display_text)
                    if embedding is not None:
                        collection.upsert(
                            ids=[chroma_id],
                            embeddings=[embedding],
                            documents=[display_text],
                            metadatas=[{
                                "source": rel_path,
                                "sheet": sheet_name,
                                "cell": cell.coordinate,
                                "is_formula": is_formula,
                                "formula": formula_text or "",
                                "file_id": file_id,
                            }],
                        )
                        embedded_count += 1
                    else:
                        embedding_failures += 1

                node_id = provenance.upsert_node(
                    file_id=file_id,
                    node_type="cell",
                    identifier=identifier,
                    display_text=display_text,
                    raw_content=formula_text,
                    location={"sheet": sheet_name, "cell": cell.coordinate},
                    chroma_id=chroma_id,
                    extra={"formula": formula_text, "computed_value": computed_value},
                )
                node_ids[identifier] = node_id

                if is_formula:
                    for ref in extract_refs(formula_text, sheet_name):
                        if "cell" in ref:
                            target_id = f"{ref['sheet']}!{ref['cell']}"
                            pending_edges.append((identifier, target_id, "depends_on"))
                        else:
                            expanded = expand_range(ref["range_start"], ref["range_end"])
                            if expanded:
                                for c in expanded:
                                    target_id = f"{ref['sheet']}!{c}"
                                    pending_edges.append((identifier, target_id, "depends_on"))
                            else:
                                # Range too large to expand — one aggregate node+edge
                                range_id = f"{ref['sheet']}!{ref['range_start']}:{ref['range_end']}"
                                if range_id not in node_ids:
                                    rid = provenance.upsert_node(
                                        file_id=file_id, node_type="cell_range", identifier=range_id,
                                        display_text=f"Range {range_id}",
                                        location={"sheet": ref["sheet"], "range": f"{ref['range_start']}:{ref['range_end']}"},
                                    )
                                    node_ids[range_id] = rid
                                pending_edges.append((identifier, range_id, "depends_on_range"))

    # Second pass: resolve edges. A referenced cell that was never
    # independently "meaningful" (no formula, no label) still needs a
    # minimal node created here so the edge doesn't dangle.
    for source_id, target_id, edge_type in pending_edges:
        if target_id not in node_ids:
            sheet_name, cell_ref = target_id.split("!", 1)
            if sheet_name not in wb_formulas.sheetnames:
                # Reference points outside this workbook's known sheets —
                # leave it as a dangling edge for now rather than guessing.
                # (Cross-workbook references are a known future extension —
                # see the "dangling edge -> prompt to add folder" discussion.)
                continue
            ws_v = wb_values[sheet_name]
            value = _json_safe(ws_v[cell_ref].value) if cell_ref in ws_v else None
            node_ids[target_id] = provenance.upsert_node(
                file_id=file_id, node_type="cell", identifier=target_id,
                display_text=f"Cell {target_id} (referenced only, no independent label)",
                location={"sheet": sheet_name, "cell": cell_ref},
                extra={"computed_value": value},
            )
        provenance.upsert_edge(node_ids[source_id], node_ids[target_id], edge_type)

    if embedding_failures > 0:
        provenance.mark_file_status(file_id, "pending")
        print(f"    {len(node_ids)} nodes, {len(pending_edges)} edges, {embedded_count} embedded, "
              f"{embedding_failures} embedding(s) FAILED — marked 'pending' for retry")
    else:
        print(f"    {len(node_ids)} nodes, {len(pending_edges)} edges, {embedded_count} embedded for semantic search")
    return embedded_count


def get_collection():
    """Shared entry point so callers other than process_all_excel_files
    (e.g. the watcher's targeted pending-retry) can get the same Chroma
    collection without duplicating the client setup."""
    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    return client.get_or_create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})


def process_all_excel_files(force=False):
    print(f"Watched folders: {WATCHED_FOLDERS}")
    provenance.ensure_schema()

    collection = get_collection()

    files = list(discover_files(WATCHED_FOLDERS))
    if not files:
        print(f"No .xlsx/.xlsm files found under:\n{WATCHED_FOLDERS}")
        return

    common_root = os.path.commonpath(WATCHED_FOLDERS) if WATCHED_FOLDERS else ""
    print(f"\nFound {len(files)} file(s):\n")
    total_embedded = 0
    for idx, filepath in enumerate(files):
        rel_path = os.path.relpath(filepath, start=common_root) if common_root else os.path.basename(filepath)
        progress.set_progress("excel", idx, len(files), current_file=rel_path)
        try:
            total_embedded += process_file(filepath, rel_path, collection, force=force)
        except Exception as e:
            print(f"    Failed to process {rel_path}: {e}")
    progress.finish_progress("excel")

    print(f"\nDone!")
    print(f"New/updated chunks embedded : {total_embedded}")
    print(f"Total in Chroma collection  : {collection.count()}")


if __name__ == "__main__":
    import sys
    force_flag = "--force" in sys.argv
    process_all_excel_files(force=force_flag)