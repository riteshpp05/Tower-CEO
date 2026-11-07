# ============================================================
# spot_check.py — APNJ Jarvis
# ============================================================
# Manual verification tool for Phase 1. Run as-is for a general
# tour of what's in the graph, or edit the two variables below to
# trace a specific cell or test a specific semantic search query.
#
# Run:
#     python spot_check.py
# ============================================================

import json
import chromadb
import requests

import provenance

# ── Edit these to explore specific things ──────────────────
FILE_NAME_MATCH = "ROI Model.xlsx"   # which indexed file to inspect
TARGET_IDENTIFIER = None             # e.g. "Pricing!C2" — leave None to auto-pick a formula cell
SEARCH_QUERY = "discount rate"       # try changing this and re-running
TRACE_HOPS = 2                       # how many hops to walk for precedents/dependents

# ── Config (matches excel_graph_processor.py) ──────────────
CONFIG_FILE = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\studio_config.json"
try:
    with open(CONFIG_FILE, encoding="utf-8") as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
CHROMA_FOLDER = cfg.get("chroma_folder", r"F:\Visual Code Directory\APNJ-LLM-Studio\data\chroma_db")
EMBED_URL = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION = "apnj_excel_v2"


def get_file_id(name_match):
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, file_path FROM jarvis_files WHERE file_path LIKE %s;", (f"%{name_match}",))
            row = cur.fetchone()
    return row


def sample_formula_nodes(file_id, limit=10):
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT identifier, raw_content, extra
                FROM jarvis_nodes
                WHERE file_id = %s AND raw_content IS NOT NULL
                ORDER BY id
                LIMIT %s;
            """, (file_id, limit))
            return cur.fetchall()


def graph_counts(file_id):
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM jarvis_nodes WHERE file_id = %s;", (file_id,))
            n_nodes = cur.fetchone()[0]
            cur.execute("""
                SELECT COUNT(*) FROM jarvis_edges e
                JOIN jarvis_nodes n ON n.id = e.source_node_id
                WHERE n.file_id = %s;
            """, (file_id,))
            n_edges = cur.fetchone()[0]
    return n_nodes, n_edges


def print_trace(file_id, identifier, hops):
    print(f"\n── Tracing: {identifier} ──")
    precedents = provenance.get_precedents(file_id, identifier, max_hops=hops)
    dependents = provenance.get_dependents(file_id, identifier, max_hops=hops)

    print(f"  Depends on ({len(precedents)} cells, up to {hops} hops):")
    for p in precedents[:15]:
        print(f"    {p['identifier']}  [{p['edge_type']}]  {p.get('display_text') or ''}")
    if len(precedents) > 15:
        print(f"    ...and {len(precedents) - 15} more")

    print(f"  Depended on by ({len(dependents)} cells, up to {hops} hops) — 'what breaks if I change this':")
    for d in dependents[:15]:
        print(f"    {d['identifier']}  [{d['edge_type']}]  {d.get('display_text') or ''}")
    if len(dependents) > 15:
        print(f"    ...and {len(dependents) - 15} more")


def get_embedding(text):
    r = requests.post(EMBED_URL, json={"model": "nomic-embed-text-v2-moe", "input": text}, timeout=30)
    return r.json()["data"][0]["embedding"]


def semantic_search(query, n=5):
    print(f"\n── Semantic search: '{query}' ──")
    try:
        embedding = get_embedding(query)
    except Exception as e:
        print(f"  Embedding server not reachable ({e}) — skipping semantic search.")
        return

    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    collection = client.get_or_create_collection(COLLECTION)
    results = collection.query(query_embeddings=[embedding], n_results=n)

    for i in range(len(results["ids"][0])):
        meta = results["metadatas"][0][i]
        doc = results["documents"][0][i]
        dist = results["distances"][0][i]
        print(f"  [{meta['sheet']}!{meta['cell']}]  (distance: {dist:.3f})")
        print(f"    {doc}")


if __name__ == "__main__":
    row = get_file_id(FILE_NAME_MATCH)
    if not row:
        print(f"No indexed file matching '{FILE_NAME_MATCH}' found in jarvis_files.")
        raise SystemExit(1)

    file_id, file_path = row
    print(f"File: {file_path}  (id={file_id})")

    n_nodes, n_edges = graph_counts(file_id)
    print(f"Total nodes: {n_nodes}   Total edges: {n_edges}")

    print(f"\n── Sample of {min(10, n_nodes)} formula cells ──")
    samples = sample_formula_nodes(file_id, limit=10)
    for identifier, raw_content, extra in samples:
        print(f"  {identifier}  =  {raw_content}")

    trace_target = TARGET_IDENTIFIER or (samples[0][0] if samples else None)
    if trace_target:
        print_trace(file_id, trace_target, TRACE_HOPS)
    else:
        print("\nNo formula cells found to trace.")

    semantic_search(SEARCH_QUERY)
