# ============================================================
# jarvis_server.py — APNJ Jarvis
# ============================================================
# Query-time backend tying the whole Phase 1 build together:
#   1. Embed the question, semantic-search apnj_excel_v2 + apnj_code
#   2. Graph-expand the top result (precedents/dependents for an
#      Excel cell, calls/imports for a code function) so a query like
#      "what does this depend on" gets structural context, not just
#      whatever happened to match semantically
#   3. Build a context block from everything retrieved, ask the chat
#      LLM (port 8080, plain /v1/chat/completions — no tools API,
#      matching the rest of this codebase's llama.cpp constraint)
#   4. Return the answer AND the exact sources used — this is the
#      fix for the gap flagged at the very start: rag_anything_server.py
#      returns "sources": [] and discards chunk-level provenance;
#      Jarvis never had that gap in the first place, because every
#      node has carried real file/location metadata since Phase 1.
#
# Run standalone for testing: python jarvis_server.py
# In production this sits behind proxy.py's /jarvis/* routes.
# ============================================================

import os
import json
import subprocess
import requests
import chromadb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import provenance
import progress
import excel_graph_processor as excel_proc
import code_graph_processor as code_proc
import folder_graph_processor as folder_proc

EMBED_URL = "http://127.0.0.1:8081/v1/embeddings"
CHAT_URL = "http://127.0.0.1:8080/v1/chat/completions"
TOP_K_PER_COLLECTION = 4
MAX_CONTEXT_CHUNKS = 8

app = FastAPI(title="APNJ Jarvis")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class AskRequest(BaseModel):
    question: str


class OpenRequest(BaseModel):
    file_id: int
    line: int | None = None


class FoldersRequest(BaseModel):
    watched_folders: list[str] | None = None


# ── Retrieval ────────────────────────────────────────────────
def get_embedding(text):
    r = requests.post(EMBED_URL, json={"model": "nomic-embed-text-v2-moe", "input": text[:2000]}, timeout=30)
    r.raise_for_status()
    return r.json()["data"][0]["embedding"]


def search_collection(client, name, embedding, source_type):
    try:
        collection = client.get_or_create_collection(name)
        results = collection.query(query_embeddings=[embedding], n_results=TOP_K_PER_COLLECTION)
    except Exception:
        return []
    out = []
    ids = results.get("ids", [[]])[0]
    for i in range(len(ids)):
        meta = results["metadatas"][0][i]
        doc = results["documents"][0][i]
        dist = results["distances"][0][i]
        relevance = max(0, min(100, round((1 - dist) * 100)))
        out.append({
            "type": source_type, "text": doc, "meta": meta,
            "relevance": relevance, "reason": "semantic match",
        })
    return out


def excel_identifier(meta):
    return f"{meta.get('sheet')}!{meta.get('cell')}"


def graph_expand(top_source):
    """
    1-hop expansion around the single top semantic hit — precedents +
    dependents for an Excel cell, calls + imports for a code node.
    Returns a list of extra source dicts (no 'relevance' score, since
    these weren't ranked by similarity — they're structurally related).
    """
    meta = top_source["meta"]
    file_id = meta.get("file_id")
    if file_id is None:
        return []

    identifier = excel_identifier(meta) if top_source["type"] == "excel" else meta.get("identifier")
    if not identifier:
        return []

    related = []
    for direction, fn in (("depends on", provenance.get_precedents), ("used by", provenance.get_dependents)):
        try:
            hits = fn(file_id, identifier, max_hops=1)
        except Exception:
            hits = []
        for h in hits[:3]:
            h_identifier = h.get("identifier", "")
            if top_source["type"] == "excel":
                # h_identifier looks like "SheetName!CellRef" — split it back
                # into sheet/cell rather than leaving the top match's location
                # on this copied metadata dict.
                if "!" in h_identifier:
                    h_sheet, h_cell = h_identifier.split("!", 1)
                else:
                    h_sheet, h_cell = meta.get("sheet"), h_identifier
                related_meta = {**meta, "sheet": h_sheet, "cell": h_cell}
            else:
                related_meta = {**meta, "identifier": h_identifier}
            related.append({
                "type": top_source["type"],
                "text": h.get("display_text") or h_identifier,
                "meta": related_meta,
                "relevance": None,
                "reason": f"{direction} the top match ({h.get('edge_type', 'related')})",
            })
    return related


def search_files_by_name(question):
    """
    Deterministic filename lookup against the folder graph (jarvis_files),
    independent of semantic search. This exists because "where is file X"
    has no good answer in the Excel/code content chunks — those describe
    formulas and functions, not file locations. Without this, the LLM has
    no real path to draw from and will guess one instead of admitting it
    doesn't know (exactly what happened before this fix).
    Matches any word in the question (4+ chars, to skip stopwords) against
    filenames — a real substring match, not a similarity guess, so results
    here get full confidence rather than a relevance score.
    """
    words = []
    for raw in question.split():
        w = raw.strip(".,?!'\"")
        # Keep normal words of 4+ chars, but also keep short ALL-CAPS
        # tokens regardless of length — acronyms like "ROI", "SOW", "MSA"
        # are exactly the terms someone would search a filename for, and
        # a flat length cutoff was silently dropping them.
        if len(w) >= 4 or (len(w) >= 2 and w.isupper()):
            words.append(w)
    if not words:
        return []
    results = []
    seen_paths = set()
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            for word in words[:6]:  # cap to avoid an excessive query fan-out
                cur.execute("""
                    SELECT id, file_path, file_type FROM jarvis_files
                    WHERE file_path ILIKE %s AND status != 'missing'
                    LIMIT 5;
                """, (f"%{word}%",))
                for file_id, file_path, file_type in cur.fetchall():
                    if file_path not in seen_paths:
                        seen_paths.add(file_path)
                        results.append({
                            "type": "file_location",
                            "text": f"The file is located at exactly this path: {file_path}",
                            "meta": {"source": os.path.basename(file_path), "file_id": file_id,
                                     "full_path": file_path, "underlying_type": file_type},
                            "relevance": None, "reason": "exact filename match",
                        })
    return results[:5]


def build_context(sources):
    parts = []
    for i, s in enumerate(sources):
        meta = s["meta"]
        if s["type"] == "file_location":
            loc = f"exact file path: {meta.get('full_path')}"
        elif s["type"] == "excel":
            loc = f"{meta.get('source')} — sheet '{meta.get('sheet')}', cell {meta.get('cell')}"
        elif s["type"] == "document":
            page_or_para = f"page {meta.get('loc_page')}" if meta.get("loc_page") is not None else f"paragraph {meta.get('loc_paragraph_index')}"
            loc = f"{meta.get('source')} — {page_or_para}"
        else:
            loc = f"{meta.get('source')} — {meta.get('identifier', '')} (lines {meta.get('line_start', '?')}-{meta.get('line_end', '?')})"
        parts.append(f"[Source {i+1}: {loc}]\n{s['text']}")
    return "\n\n---\n\n".join(parts)


def ask_llm(question, context):
    prompt = f"""You are Jarvis, an AI assistant with access to the user's Excel models and codebase, \
including formula dependencies and function call/import relationships — not just plain text.
Answer the question using the excerpts below. When a source shows a dependency or call relationship, \
you can reference that relationship directly (e.g. "this depends on cell X" or "this function calls Y").
Only state a specific file path if one is given explicitly in an excerpt below (look for "exact file path:") \
— never guess, infer, or construct a plausible-looking path yourself.
If the answer isn't in the excerpts, say so plainly rather than guessing.

CONTEXT:
{context}

QUESTION: {question}

ANSWER:"""
    payload = {
        "model": "gemma",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 1024,
    }
    try:
        r = requests.post(CHAT_URL, json=payload, timeout=90)
        data = r.json()
        return data["choices"][0]["message"]["content"] or "The model returned an empty response."
    except Exception as e:
        return f"Error contacting the chat model: {e}"


def format_sources_for_ui(sources):
    formatted = []
    for s in sources:
        meta = s["meta"]
        if s["type"] == "file_location":
            file_display = meta.get("source", "")
            location = meta.get("full_path", "")
            display_type = meta.get("underlying_type") or "other"
        elif s["type"] == "excel":
            file_display = meta.get("source", "")
            location = f"{meta.get('sheet')}!{meta.get('cell')}"
            display_type = "excel"
        elif s["type"] == "document":
            file_display = meta.get("source", "")
            location = f"page {meta.get('loc_page')}" if meta.get("loc_page") is not None else f"paragraph {meta.get('loc_paragraph_index')}"
            display_type = "document"
        else:
            file_display = meta.get("source", "")
            location = meta.get("identifier", "").split("::", 1)[-1]
            display_type = "code"

        formatted.append({
            "type": s["type"], "display_type": display_type, "file": file_display, "location": location,
            "reason": s["reason"], "relevance": s["relevance"],
            "snippet": s["text"][:220], "file_id": meta.get("file_id"),
            "line_start": meta.get("line_start"),
        })
    return formatted


# ── Routes ───────────────────────────────────────────────────
@app.get("/folders")
def get_folders():
    """
    Current watched-folder configuration, read live from disk so it
    always reflects the actual state the processors would use on their
    next run — not a cached copy. Every processor (Excel, code, folder
    graph, documents) now reads the same single "watched_folders" list.
    """
    try:
        with open(excel_proc.CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        return {"error": f"Could not read config: {e}"}
    watched = cfg.get("watched_folders") or cfg.get("code_folders") or ([cfg["excel_folder"]] if cfg.get("excel_folder") else [])
    return {"watched_folders": watched}


@app.post("/folders")
def set_folders(req: FoldersRequest):
    """
    Updates the single "watched_folders" key in studio_config.json,
    leaving every other key (doc_folder, crawl_list, chroma_folder, etc.
    — used by the legacy/RAGAnything paths) completely untouched. This
    only changes what the *next* processor/watcher run will scan — it
    doesn't retroactively reprocess or clean up anything by itself.
    """
    try:
        with open(excel_proc.CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        return {"error": f"Could not read config: {e}"}

    if req.watched_folders is not None:
        cfg["watched_folders"] = req.watched_folders

    try:
        with open(excel_proc.CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        return {"error": f"Could not write config: {e}"}

    return {"saved": True, "note": "Takes effect on the next processor run or watcher restart — nothing was rescanned automatically."}


@app.get("/progress")
def get_progress_route():
    """
    Live progress from whichever processor is currently running —
    these run as separate processes (manual runs or the watcher), so
    this just reads the shared progress file rather than tracking
    anything jarvis_server.py itself is doing.
    """
    return progress.get_progress()


@app.get("/status")
def status():
    try:
        provenance.ensure_schema()
        with provenance.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM jarvis_files WHERE status != 'missing';")
                files = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM jarvis_nodes;")
                nodes = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM jarvis_edges;")
                edges = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM jarvis_files WHERE status = 'pending';")
                pending = cur.fetchone()[0]

        client = chromadb.PersistentClient(path=excel_proc.CHROMA_FOLDER)
        excel_chunks = client.get_or_create_collection("apnj_excel_v2").count()
        code_chunks = client.get_or_create_collection("apnj_code").count()

        return {
            "status": "ready", "files": files, "nodes": nodes, "edges": edges,
            "pending_embeddings": pending, "excel_chunks": excel_chunks, "code_chunks": code_chunks,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/ask")
def ask(req: AskRequest):
    question = req.question.strip()
    if not question:
        return {"error": "Empty question."}

    try:
        embedding = get_embedding(question)
    except Exception as e:
        return {"error": f"Could not reach embedding server: {e}"}

    client = chromadb.PersistentClient(path=excel_proc.CHROMA_FOLDER)
    excel_hits = search_collection(client, "apnj_excel_v2", embedding, "excel")
    code_hits = search_collection(client, "apnj_code", embedding, "code")
    doc_hits = search_collection(client, "apnj_doc_graph", embedding, "document")
    file_hits = search_files_by_name(question)

    combined = sorted(excel_hits + code_hits + doc_hits, key=lambda s: s["relevance"], reverse=True)
    if not combined and not file_hits:
        return {
            "answer": "Nothing relevant found in the Excel, code, or document graph for that question.",
            "sources": [],
        }

    # When a deterministic filename match exists, it's much stronger grounding
    # than any semantic guess — dilute it less. Without this, a location-type
    # question with no real code relevance still pulled in 4 mediocre code
    # matches purely because TOP_K_PER_COLLECTION(4) x 2 collections always
    # equalled MAX_CONTEXT_CHUNKS(8), making that cap a complete no-op — every
    # fetched candidate always made it into context regardless of quality.
    semantic_budget = 2 if file_hits else MAX_CONTEXT_CHUNKS
    top_sources = combined[:semantic_budget]
    related = graph_expand(top_sources[0]) if top_sources else []
    # File-location hits go first — deterministic filename matches are the
    # strongest possible grounding for a "where is X" question, and putting
    # them ahead of semantic guesses in the context makes it more likely the
    # model actually uses them instead of the lower-confidence chunks.
    all_sources = file_hits + top_sources + related

    context = build_context(all_sources)
    answer = ask_llm(question, context)

    return {"answer": answer, "sources": format_sources_for_ui(all_sources)}


@app.post("/open")
def open_file(req: OpenRequest):
    path = provenance.get_file_path(req.file_id)
    if not path or not os.path.exists(path):
        return {"error": f"File not found for file_id={req.file_id}"}
    try:
        if req.line:
            # Prefer opening code at the exact line in VS Code if it's on PATH.
            subprocess.Popen(["code", "--goto", f"{path}:{req.line}"], shell=True)
        else:
            os.startfile(path)  # Windows-only, matches this environment
        return {"opened": True}
    except Exception:
        try:
            os.startfile(path)
            return {"opened": True}
        except Exception as e2:
            return {"error": f"Could not open file: {e2}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3004)