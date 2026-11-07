# ============================================================
# code_graph_processor.py — APNJ Jarvis
# ============================================================
# Parses Python (via the stdlib `ast` module) and JS/JSX/TS/TSX
# (via tree-sitter) into the same node/edge graph pattern as
# excel_graph_processor.py — functions, methods, and classes
# become nodes; calls, imports, and inheritance become edges.
#
# WHY TWO PASSES:
#   A function call or import can point at something defined in a
#   *different* file (e.g. utils.py::validate_input called from
#   cfo_server.py). To resolve that, every file's nodes need to
#   exist first, so pass 1 parses every file and builds a global
#   name -> node index; pass 2 walks the calls/imports collected
#   during pass 1 and resolves them against that index.
#
#   Name-based resolution is a known simplification (not full
#   scope/import resolution) — see SETUP_JARVIS_CODE.md. If a name
#   matches functions in multiple files, the edge is still created
#   to every candidate, but with a lower confidence score, so the
#   ambiguity is visible rather than silently guessed away.
#
# Every node carries provenance: file path + exact line range,
# same as Excel's file+sheet+cell — the sources panel treats a
# function the same way it treats a formula cell.
# ============================================================

import os
import ast
import json
import requests
import chromadb

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

# List of repo root folders to scan, e.g.:
#   "code_folders": [
#       "./backend",
#       "./frontend-cfo",
#       "./frontend-tender"
#   ]
# Add this key to studio_config.json — defaults to empty (nothing scanned)
# rather than guessing, since scope should always be explicit (see the
# watcher/scoping discussion — this tool only ever looks where it's told to).
# Unified with every other processor onto a single "watched_folders" key —
# code_folders is kept only as a fallback for configs written before this
# unification.
CODE_FOLDERS = cfg.get("watched_folders", cfg.get("code_folders", []))

CHROMA_FOLDER = cfg.get("chroma_folder", r"F:\Visual Code Directory\APNJ-LLM-Studio\data\chroma_db")
EMBED_URL = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION = "apnj_code"

EXT_LANGUAGE = {
    ".py": "python",
    ".js": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "tsx",
}

EXCLUDE_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", "site-packages", "chroma_db",
}


def discover_files(folders):
    for folder in folders:
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in EXT_LANGUAGE:
                    yield os.path.join(root, fname), EXT_LANGUAGE[ext]


# ── Python extraction (ast) ─────────────────────────────────
def extract_python(rel_path, source):
    """
    Returns (nodes, pending_calls, pending_imports, pending_inherits).
    nodes: list of dicts ready for provenance.upsert_node.
    pending_*: list of (source_identifier, target_name) tuples to
    resolve in pass 2, once every file's nodes exist.
    """
    nodes = []
    pending_calls = []
    pending_imports = []
    pending_inherits = []

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        print(f"    Skipping {rel_path}: syntax error ({e})")
        return nodes, pending_calls, pending_imports, pending_inherits

    module_identifier = f"{rel_path}::<module>"
    nodes.append({
        "identifier": module_identifier, "node_type": "module",
        "display_text": f"Module {rel_path}", "raw_content": None,
        "location": {"line_start": 1, "line_end": len(source.splitlines())},
        "extra": {},
    })

    def call_target_name(call_node):
        fn = call_node.func
        if isinstance(fn, ast.Name):
            return fn.id
        if isinstance(fn, ast.Attribute):
            return fn.attr
        return None

    def collect_calls(body_node, source_identifier):
        for n in ast.walk(body_node):
            if isinstance(n, ast.Call):
                name = call_target_name(n)
                if name:
                    pending_calls.append((source_identifier, name))

    def handle_function(fn_node, class_name=None):
        qualname = f"{class_name}.{fn_node.name}" if class_name else fn_node.name
        identifier = f"{rel_path}::{qualname}"
        args = [a.arg for a in fn_node.args.args]
        signature = f"{fn_node.name}({', '.join(args)})"
        docstring = ast.get_docstring(fn_node)
        raw = ast.get_source_segment(source, fn_node)
        display = f"{'Method' if class_name else 'Function'} {signature} in {rel_path}."
        if docstring:
            display += f" {docstring.strip().splitlines()[0]}"

        nodes.append({
            "identifier": identifier, "node_type": "method" if class_name else "function",
            "display_text": display, "raw_content": raw,
            "location": {"line_start": fn_node.lineno, "line_end": fn_node.end_lineno},
            "extra": {"signature": signature, "docstring": docstring, "class": class_name},
        })
        collect_calls(fn_node, identifier)
        if class_name:
            pending_inherits.append((identifier, f"{rel_path}::{class_name}", "defined_in"))

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            handle_function(node)

        elif isinstance(node, ast.ClassDef):
            class_identifier = f"{rel_path}::{node.name}"
            raw = ast.get_source_segment(source, node)
            docstring = ast.get_docstring(node)
            display = f"Class {node.name} in {rel_path}."
            if docstring:
                display += f" {docstring.strip().splitlines()[0]}"
            nodes.append({
                "identifier": class_identifier, "node_type": "class",
                "display_text": display, "raw_content": raw,
                "location": {"line_start": node.lineno, "line_end": node.end_lineno},
                "extra": {"docstring": docstring},
            })
            for base in node.bases:
                base_name = base.id if isinstance(base, ast.Name) else None
                if base_name:
                    pending_inherits.append((class_identifier, base_name, "inherits"))
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    handle_function(item, class_name=node.name)

        elif isinstance(node, ast.Import):
            for alias in node.names:
                pending_imports.append((module_identifier, alias.name))
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                pending_imports.append((module_identifier, node.module))
            else:
                # `from . import auth` style — no module name, just names
                for alias in node.names:
                    pending_imports.append((module_identifier, alias.name))

    return nodes, pending_calls, pending_imports, pending_inherits


# ── JS/TS/JSX extraction (tree-sitter) ──────────────────────
def extract_js(rel_path, source_bytes, language):
    from tree_sitter_languages import get_parser
    parser = get_parser(language)
    tree = parser.parse(source_bytes)

    nodes = []
    pending_calls = []
    pending_imports = []
    pending_inherits = []

    def text(n):
        return source_bytes[n.start_byte:n.end_byte].decode(errors="replace")

    module_identifier = f"{rel_path}::<module>"
    nodes.append({
        "identifier": module_identifier, "node_type": "module",
        "display_text": f"Module {rel_path}", "raw_content": None,
        "location": {"line_start": 1, "line_end": tree.root_node.end_point[0] + 1},
        "extra": {},
    })

    def add_function_node(name_node, def_node, class_name=None):
        if name_node is None:
            return None
        name = text(name_node)
        qualname = f"{class_name}.{name}" if class_name else name
        identifier = f"{rel_path}::{qualname}"
        raw = text(def_node)
        display = f"{'Method' if class_name else 'Function'} {qualname} in {rel_path}."
        nodes.append({
            "identifier": identifier, "node_type": "method" if class_name else "function",
            "display_text": display, "raw_content": raw[:2000],
            "location": {"line_start": def_node.start_point[0] + 1, "line_end": def_node.end_point[0] + 1},
            "extra": {"class": class_name},
        })
        if class_name:
            pending_inherits.append((identifier, f"{rel_path}::{class_name}", "defined_in"))
        return identifier

    def collect_calls(node, source_identifier):
        for n in walk_all(node):
            if n.type == "call_expression":
                fn = n.child_by_field_name("function")
                if fn is None:
                    continue
                if fn.type == "identifier":
                    pending_calls.append((source_identifier, text(fn)))
                elif fn.type == "member_expression":
                    prop = fn.child_by_field_name("property")
                    if prop:
                        pending_calls.append((source_identifier, text(prop)))

    def walk_all(node):
        yield node
        for c in node.children:
            yield from walk_all(c)

    current_function_stack = []

    def walk(node, class_name=None):
        if node.type == "import_statement":
            source_node = node.child_by_field_name("source")
            if source_node:
                pending_imports.append((module_identifier, text(source_node).strip("'\"")))

        elif node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
            fn_id = add_function_node(name_node, node, class_name)
            if fn_id:
                collect_calls(node, fn_id)

        elif node.type == "method_definition":
            name_node = node.child_by_field_name("name")
            fn_id = add_function_node(name_node, node, class_name)
            if fn_id:
                collect_calls(node, fn_id)

        elif node.type == "variable_declarator":
            value = node.child_by_field_name("value")
            if value is not None and value.type in ("arrow_function", "function_expression"):
                name_node = node.child_by_field_name("name")
                fn_id = add_function_node(name_node, node, class_name)
                if fn_id:
                    collect_calls(value, fn_id)

        elif node.type == "class_declaration":
            name_node = node.child_by_field_name("name")
            if name_node:
                new_class_name = text(name_node)
                class_identifier = f"{rel_path}::{new_class_name}"
                nodes.append({
                    "identifier": class_identifier, "node_type": "class",
                    "display_text": f"Class {new_class_name} in {rel_path}.",
                    "raw_content": text(node)[:2000],
                    "location": {"line_start": node.start_point[0] + 1, "line_end": node.end_point[0] + 1},
                    "extra": {},
                })
                heritage = node.child_by_field_name("superclass")
                if heritage:
                    pending_inherits.append((class_identifier, text(heritage), "inherits"))
                for child in node.children:
                    walk(child, class_name=new_class_name)
                return  # already recursed with class context — don't fall through to generic recursion

        for child in node.children:
            walk(child, class_name=class_name)

    walk(tree.root_node)
    return nodes, pending_calls, pending_imports, pending_inherits


# ── Embedding + Chroma ──────────────────────────────────────
def get_embedding(text):
    try:
        r = requests.post(EMBED_URL, json={"model": "nomic-embed-text-v2-moe", "input": text[:2000]}, timeout=30)
        return r.json()["data"][0]["embedding"]
    except Exception as e:
        print(f"    Embedding failed: {e}")
        return None


def _import_lookup_key(target_name):
    """
    Reduce an import target to the name it'd be indexed under.
    JS/TS relative paths ('./utils', '../hooks/useAuth') use '/' —
    basename + strip extension. Python dotted module paths
    ('cfo_tower.chat.auth') use '.' as the separator, not a file
    extension — os.path.splitext would wrongly treat 'auth' as an
    extension on the first form, so dotted paths take the last
    '.'-segment instead.
    """
    if "/" in target_name:
        return os.path.splitext(os.path.basename(target_name))[0]
    return target_name.rsplit(".", 1)[-1]


# ── Driver: two-pass processing across the whole scanned codebase ──
def process_all_code_files(force=False):
    if not CODE_FOLDERS:
        print("No code_folders configured in studio_config.json — nothing to scan.")
        print('Add e.g. "code_folders": ["F:\\\\Visual Code Directory\\\\ais-cfo-tower"]')
        return

    provenance.ensure_schema()
    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    collection = client.get_or_create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})

    name_index = {}          # function/class name -> list of (file_id, identifier, node_db_id)
    all_pending_calls = []   # (file_id, source_identifier, target_name)
    all_pending_imports = []
    all_pending_inherits = []
    embedded_count = 0
    files_processed = 0

    files = list(discover_files(CODE_FOLDERS))
    print(f"Found {len(files)} code file(s) across {len(CODE_FOLDERS)} folder(s).\n")

    # ── Pass 1: parse every file, create nodes, build the name index ──
    for idx, (filepath, language) in enumerate(files):
        rel_path = os.path.relpath(filepath, start=os.path.commonpath(CODE_FOLDERS))
        progress.set_progress("code", idx, len(files), current_file=rel_path)

        if not force and not provenance.file_needs_reindex(filepath):
            continue

        try:
            with open(filepath, "rb") as f:
                raw_bytes = f.read()
        except Exception as e:
            print(f"    Could not read {rel_path}: {e}")
            continue

        file_id = provenance.upsert_file(filepath, file_type="code")
        provenance.clear_outgoing_edges_for_file(file_id)

        if language == "python":
            try:
                source = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                source = raw_bytes.decode("latin-1")
            nodes, calls, imports, inherits = extract_python(rel_path, source)
        else:
            nodes, calls, imports, inherits = extract_js(rel_path, raw_bytes, language)

        files_processed += 1
        print(f"  {rel_path}: {len(nodes)} nodes")
        file_embedding_failures = 0

        for n in nodes:
            chroma_id = None
            if n["node_type"] in ("function", "method", "class") and n["display_text"]:
                chroma_id = f"{rel_path}::{n['identifier'].split('::', 1)[-1]}"
                embedding = get_embedding(n["display_text"])
                if embedding is not None:
                    collection.upsert(
                        ids=[chroma_id], embeddings=[embedding], documents=[n["display_text"]],
                        metadatas=[{
                            "source": rel_path, "identifier": n["identifier"],
                            "node_type": n["node_type"],
                            "line_start": n["location"].get("line_start", 0),
                            "line_end": n["location"].get("line_end", 0),
                            "file_id": file_id,
                        }],
                    )
                    embedded_count += 1
                else:
                    file_embedding_failures += 1

            node_db_id = provenance.upsert_node(
                file_id=file_id, node_type=n["node_type"], identifier=n["identifier"],
                display_text=n["display_text"], raw_content=n["raw_content"],
                location=n["location"], chroma_id=chroma_id, extra=n["extra"],
            )

            if n["node_type"] == "module":
                module_name = os.path.splitext(os.path.basename(rel_path))[0]
                name_index.setdefault(module_name, []).append((file_id, n["identifier"], node_db_id))
                if module_name == "__init__":
                    # `from cfo_tower.chat import X` style package imports resolve
                    # against the package (parent folder) name, not "__init__".
                    pkg_name = os.path.basename(os.path.dirname(rel_path))
                    if pkg_name:
                        name_index.setdefault(pkg_name, []).append((file_id, n["identifier"], node_db_id))
            else:
                short_name = n["identifier"].split("::", 1)[-1].split(".")[-1]
                name_index.setdefault(short_name, []).append((file_id, n["identifier"], node_db_id))

        for source_identifier, target_name in calls:
            all_pending_calls.append((file_id, source_identifier, target_name))
        for source_identifier, target_name in imports:
            all_pending_imports.append((file_id, source_identifier, target_name))
        for source_identifier, target_identifier, edge_type in inherits:
            all_pending_inherits.append((file_id, source_identifier, target_identifier, edge_type))

        if file_embedding_failures > 0:
            provenance.mark_file_status(file_id, "pending")
            print(f"    {file_embedding_failures} embedding(s) FAILED for this file — marked 'pending' for retry")

    # ── Pass 2: resolve calls/inherits against the name index ──
    def _module_of(identifier):
        return os.path.splitext(os.path.basename(identifier.split("::")[0]))[0]

    # Which modules does each file actually import? Built from pass-1 data,
    # independent of whether the import edge itself resolved — used purely
    # to disambiguate calls, e.g. deciding between chat_service.handle_turn
    # and chat_service_sales.handle_turn based on which one this file
    # actually imports.
    file_imports = {}
    for file_id, _source_identifier, target_name in all_pending_imports:
        file_imports.setdefault(file_id, set()).add(_import_lookup_key(target_name))

    def resolve_call(file_id, source_identifier, target_name):
        source_node_id = provenance.get_node_id(file_id, source_identifier)
        if source_node_id is None:
            return 0
        # Exclude the caller's own node first — every function is trivially
        # "named after itself" in the index, so without this, a function
        # calling a same-named function elsewhere (e.g. route handler
        # create_session() calling service.create_session()) would find
        # itself as a false same-file match and resolve to nothing.
        candidates = [c for c in name_index.get(target_name, []) if c[2] != source_node_id]
        if not candidates:
            return 0

        # 1. A same-file function of this name wins outright — a local
        #    call almost never means "the other file's function".
        same_file = [c for c in candidates if c[0] == file_id]
        if same_file:
            chosen = same_file
        else:
            # 2. Otherwise, prefer candidates whose containing module is
            #    something this file actually imports — this is what
            #    resolves the chat_service vs chat_service_sales case.
            imported = file_imports.get(file_id, set())
            module_matched = [c for c in candidates if _module_of(c[1]) in imported]
            chosen = module_matched if module_matched else candidates

        confidence = 1.0 if len(chosen) == 1 else round(1.0 / len(chosen), 2)
        linked = 0
        for _, _, target_node_id in chosen:
            if target_node_id != source_node_id:
                provenance.upsert_edge(source_node_id, target_node_id, "calls", confidence=confidence)
                linked = 1
        return linked

    def resolve_and_link(file_id, source_identifier, target_name, edge_type):
        source_node_id = provenance.get_node_id(file_id, source_identifier)
        if source_node_id is None:
            return 0
        candidates = name_index.get(target_name, [])
        if not candidates:
            return 0
        confidence = 1.0 if len(candidates) == 1 else round(1.0 / len(candidates), 2)
        for _, _, target_node_id in candidates:
            if target_node_id != source_node_id:
                provenance.upsert_edge(source_node_id, target_node_id, edge_type, confidence=confidence)
        return 1

    resolved_calls = sum(
        resolve_call(fid, sid, name) for fid, sid, name in all_pending_calls
    )
    resolved_inherits = 0
    for file_id, source_identifier, target_identifier, edge_type in all_pending_inherits:
        source_node_id = provenance.get_node_id(file_id, source_identifier)
        target_node_id = provenance.get_node_id(file_id, target_identifier)
        if source_node_id and target_node_id:
            provenance.upsert_edge(source_node_id, target_node_id, edge_type, confidence=1.0)
            resolved_inherits += 1
        elif source_node_id:
            # base class defined in a different file — best-effort name resolution
            base_name = target_identifier.split("::", 1)[-1]
            resolved_inherits += resolve_and_link(file_id, source_identifier, base_name, edge_type)

    # Imports: only linked when the target resolves to a known file in this
    # scanned set (relative/local imports). External package imports (react,
    # fastapi, etc.) are intentionally left unlinked — there's no node to
    # point them at, and that's expected, not a bug.
    resolved_imports = 0
    for file_id, source_identifier, target_name in all_pending_imports:
        key = _import_lookup_key(target_name)
        candidates = name_index.get(key, [])
        if candidates:
            resolved_imports += resolve_and_link(file_id, source_identifier, key, "imports")

    progress.finish_progress("code")
    print(f"\nDone!")
    print(f"Files processed        : {files_processed}")
    print(f"Chunks embedded        : {embedded_count}")
    print(f"Call edges resolved    : {resolved_calls} / {len(all_pending_calls)} attempted")
    print(f"Inherit edges resolved : {resolved_inherits} / {len(all_pending_inherits)} attempted")
    print(f"Import edges resolved  : {resolved_imports} / {len(all_pending_imports)} attempted (external packages intentionally skipped)")
    print(f"Total in Chroma collection: {collection.count()}")


if __name__ == "__main__":
    import sys
    force_flag = "--force" in sys.argv
    process_all_code_files(force=force_flag)