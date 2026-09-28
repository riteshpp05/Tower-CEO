"""
rag_anything_server.py  —  APNJ LLM Studio
===============================================================
A self-contained FastAPI server that embeds RAGAnything directly.
Runs on port 3001 and preserves every /rag/* URL used by proxy.py.

This is a DROP-IN replacement for rag_server.py:
  • proxy.py unchanged  (still routes /rag/* → port 3001)
  • llmClient.ts unchanged  (same /rag/ paths)
  • All existing endpoints preserved with identical request/response shapes

RAGAnything key facts (from the library, not a separate server):
  • RAGAnything is imported as a Python class, not a CLI
  • Each "workspace" = a RAGAnythingConfig(working_dir=<path>) instance
  • Documents are indexed with: await rag.process_document_complete(path, output_dir)
  • Queries run with:           result = await rag.aquery(question, mode="hybrid")
  • Per-proposal isolation = one RAGAnything instance per rfpSessionId, persisted on disk

Start this with:
    python rag_anything_server.py
OR via the supplied Start-RAG-Bridge.bat
===============================================================
"""

import asyncio
import io
import json
import os
import re
import tempfile
import time
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

import uvicorn
import threading
import uuid
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ── RAGAnything imports ───────────────────────────────────────
from raganything import RAGAnything, RAGAnythingConfig
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc

# ── CONFIG ────────────────────────────────────────────────────
BASE_DIR       = r"F:\Visual Code Directory\APNJ-LLM-Studio"
WORKSPACES_DIR = os.path.join(BASE_DIR, "data", "rag_anything_workspaces")
MINERU_OUTPUT  = os.path.join(BASE_DIR, "data", "mineru_output")
CONFIG_FILE    = os.path.join(BASE_DIR, "data", "studio_config.json")
SERVER_PORT    = 3001

# LLM + Embedding — point at your existing APNJ-LLM-Studio services
LLM_BASE_URL   = "http://127.0.0.1:8080/v1"
EMBED_BASE_URL = "http://127.0.0.1:8081/v1"
LLM_MODEL      = "gemma"
EMBED_MODEL    = "nomic-embed-text-v2-moe"
EMBED_DIM      = 768

# Named workspaces for the knowledge base
WORKSPACE_DOCS  = "apnj_documents"
WORKSPACE_EXCEL = "apnj_excel"
WORKSPACE_WEB   = "apnj_web"

QUERY_MODE      = "hybrid"   # local + global graph search combined
DEFAULT_CONFIG = {
    "doc_folder":     os.path.join(BASE_DIR, "data", "uploaded_docs"),
    "excel_folder":   os.path.join(BASE_DIR, "data", "uploaded_excels"),
    "crawled_folder": os.path.join(BASE_DIR, "data", "crawled_pages"),
}

os.makedirs(WORKSPACES_DIR, exist_ok=True)
os.makedirs(MINERU_OUTPUT,  exist_ok=True)


# ── LLM / Embedding function builders ────────────────────────

def make_llm_func():
    """Build the async LLM completion function pointing at Gemma."""
    return partial(
        openai_complete_if_cache,
        model=LLM_MODEL,
        base_url=LLM_BASE_URL,
        api_key="not-needed",
    )


def make_embedding_func():
    """Build the embedding function pointing at Nomic-Embed."""
    return EmbeddingFunc(
        embedding_dim=EMBED_DIM,
        max_token_size=8192,
        func=partial(
            openai_embed,
            model=EMBED_MODEL,
            base_url=EMBED_BASE_URL,
            api_key="not-needed",
        ),
    )


# ── RAGAnything instance pool ─────────────────────────────────
# We keep one RAGAnything instance per workspace alive in memory.
# Instances are created lazily and cached. On restart they reload
# from disk (RAGAnything persists graph+vectors in working_dir).

_instances: dict[str, RAGAnything] = {}

# ── Async job store ───────────────────────────────────────────
# Stores background extraction jobs: job_id → {status, result, error}
_jobs: dict[str, dict] = {}



async def get_rag(workspace: str) -> RAGAnything:
    """
    Get or create a RAGAnything instance for the given workspace name.
    workspace maps directly to a subdirectory of WORKSPACES_DIR.
    """
    if workspace in _instances:
        return _instances[workspace]

    working_dir = os.path.join(WORKSPACES_DIR, workspace)
    os.makedirs(working_dir, exist_ok=True)

    config = RAGAnythingConfig(
        working_dir=working_dir,
    )

    rag = RAGAnything(
        config=config,
        llm_model_func=make_llm_func(),
        embedding_func=make_embedding_func(),
    )

    _instances[workspace] = rag
    return rag


# ── Config helpers ────────────────────────────────────────────

def load_config() -> dict:
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        for k, v in DEFAULT_CONFIG.items():
            cfg.setdefault(k, v)
        return cfg
    except Exception:
        return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


# ── FastAPI app ───────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-warm the three permanent KB workspaces on startup."""
    print(f"\n{'='*55}")
    print("APNJ RAG Server — RAG-Anything + MinerU Edition")
    print(f"{'='*55}")
    print(f"Port           : {SERVER_PORT}")
    print(f"Workspaces dir : {WORKSPACES_DIR}")
    print(f"LLM            : {LLM_BASE_URL}  ({LLM_MODEL})")
    print(f"Embeddings     : {EMBED_BASE_URL}  ({EMBED_MODEL})")
    print("\nPre-warming KB workspaces...")
    for ws in (WORKSPACE_DOCS, WORKSPACE_EXCEL, WORKSPACE_WEB):
        try:
            await get_rag(ws)
            print(f"  ✅ {ws}")
        except Exception as e:
            print(f"  ⚠  {ws}: {e}")
    print("\nWaiting for requests...\n")
    yield
    # Cleanup not needed — RAGAnything persists to disk automatically


app = FastAPI(title="APNJ RAG Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response models ───────────────────────────────────

class QueryRequest(BaseModel):
    question: str


class RfpQueryRequest(BaseModel):
    question: str
    proposal_id: str
    type: str = "scope"


# ── Shared query logic ────────────────────────────────────────

async def query_workspace(question: str, workspace: str) -> dict:
    """Query a RAGAnything workspace. Returns answer + has_context flag."""
    rag     = await get_rag(workspace)
    answer  = await rag.aquery(question.strip(), mode=QUERY_MODE)
    has_ctx = bool(answer and answer.strip() and
                   "no information" not in answer.lower()[:60])
    return {
        "answer":      answer or "",
        "sources":     [],        # RAGAnything graph responses don't carry chunk-level sources
        "chunks_used": 1 if has_ctx else 0,
        "has_context": has_ctx,
    }


# ── Endpoints ─────────────────────────────────────────────────

@app.get("/rag/status")
async def rag_status():
    """Report how many documents are indexed per workspace."""
    counts = {}
    for ws in (WORKSPACE_DOCS, WORKSPACE_EXCEL, WORKSPACE_WEB):
        ws_dir = os.path.join(WORKSPACES_DIR, ws)
        # Count .json chunk files RAGAnything writes to working_dir
        try:
            files = [f for f in os.listdir(ws_dir) if f.endswith(".json")]
            counts[ws] = len(files)
        except FileNotFoundError:
            counts[ws] = 0

    return {
        "status":            "ready",
        "rag_backend":       "RAG-Anything (MinerU)",
        "documents":         counts.get(WORKSPACE_DOCS, 0),
        "excel_files":       counts.get(WORKSPACE_EXCEL, 0),
        "web_pages":         counts.get(WORKSPACE_WEB, 0),
    }


@app.get("/rag/excel/status")
@app.get("/rag/web/status")
async def rag_status_alias():
    return await rag_status()


@app.post("/rag/unified")
async def rag_unified(req: QueryRequest):
    """
    Search all three KB workspaces (documents, excel, web) and return a
    synthesised answer. Equivalent to the old /rag/unified endpoint.
    """
    question = req.question.strip()
    if not question:
        raise HTTPException(400, "No question provided")

    print(f"\n🔮 UNIFIED: {question}")

    results = []
    workspace_defs = [
        (WORKSPACE_DOCS,  "📄 Document"),
        (WORKSPACE_EXCEL, "📊 Excel"),
        (WORKSPACE_WEB,   "🌐 Web"),
    ]

    for workspace, label in workspace_defs:
        try:
            rag    = await get_rag(workspace)
            answer = await rag.aquery(question, mode=QUERY_MODE)
            if answer and answer.strip() and "no information" not in answer.lower()[:80]:
                results.append({"label": label, "answer": answer.strip()})
                print(f"   {label}: result found")
        except Exception as e:
            print(f"   {label} search error: {e}")

    if not results:
        print("   No relevant results — pure chat mode")
        return {"answer": None, "sources": [], "chunks_used": 0, "has_context": False}

    # Combine results into a single answer via a second LLM call
    # (or just concatenate if only one workspace had results)
    if len(results) == 1:
        combined_answer = results[0]["answer"]
    else:
        context = "\n\n---\n\n".join(
            f"[{r['label']}]\n{r['answer']}" for r in results
        )
        # Re-use the docs workspace's LLM to synthesise
        rag = await get_rag(WORKSPACE_DOCS)
        synthesis_prompt = (
            f"Synthesise the following knowledge-base excerpts into a single coherent answer "
            f"to the question: '{question}'\n\nEXCERPTS:\n{context}\n\nANSWER:"
        )
        combined_answer = await rag.aquery(synthesis_prompt, mode="naive")

    sources = [{"file": r["label"], "relevance": 80} for r in results]
    print("✅ Unified answer ready")
    return {
        "answer":      combined_answer,
        "sources":     sources,
        "chunks_used": len(results),
        "has_context": True,
    }


@app.post("/rag/query")
async def rag_query(req: QueryRequest):
    """Search documents workspace only."""
    if not req.question.strip():
        raise HTTPException(400, "No question provided")
    print(f"\n📄 DOCS: {req.question}")
    return await query_workspace(req.question, WORKSPACE_DOCS)


@app.post("/rag/excel")
async def rag_excel(req: QueryRequest):
    """Search Excel workspace only."""
    if not req.question.strip():
        raise HTTPException(400, "No question provided")
    print(f"\n📊 EXCEL: {req.question}")
    return await query_workspace(req.question, WORKSPACE_EXCEL)


@app.post("/rag/web")
async def rag_web(req: QueryRequest):
    """Search web pages workspace only."""
    if not req.question.strip():
        raise HTTPException(400, "No question provided")
    print(f"\n🌐 WEB: {req.question}")
    return await query_workspace(req.question, WORKSPACE_WEB)


@app.post("/rag/extract-docx")
async def rag_extract_docx(file: UploadFile = File(...)):
    """
    Accept .docx, .pdf, .jpg, .jpeg, .png, .tiff uploads.
    - DOCX → python-docx (instant, synchronous)
    - PDF/Image → async job (returns job_id immediately, poll /rag/job-status/{job_id})
    """
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    filename = file.filename or "document"
    suffix   = Path(filename).suffix.lower()

    if suffix not in (".docx", ".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif"):
        raise HTTPException(400, f"Unsupported file type: {suffix}")

    # ── DOCX → python-docx (synchronous, instant) ────────────
    if suffix == ".docx":
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            text = _extract_docx_to_markdown(tmp_path)
            if not text.strip():
                raise HTTPException(422, "Document appears empty or unreadable")
            print(f"  [EXTRACT] python-docx: {len(text)} chars from {filename}")
            return {"text": text}
        finally:
            os.unlink(tmp_path)

    # ── PDF/Image → async background job ─────────────────────
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "result": None, "error": None, "filename": filename, "pages_done": 0, "pages_total": 0}

    # Save file content for background thread
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    # Start background thread
    def run_extraction():
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            if suffix == ".pdf":
                result = loop.run_until_complete(_extract_pdf_via_qwen_vl(tmp_path, filename, job_id))
            else:
                result = loop.run_until_complete(_extract_image_via_qwen_vl(tmp_path, filename))
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["result"] = result
        except Exception as e:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"] = str(e)
        finally:
            try: os.unlink(tmp_path)
            except: pass
            loop.close()

    thread = threading.Thread(target=run_extraction, daemon=True)
    thread.start()

    print(f"  [EXTRACT-ASYNC] job_id={job_id} file={filename}")
    return {"job_id": job_id, "status": "processing", "message": f"Extraction started for {filename}. Poll /rag/job-status/{job_id}"}


@app.get("/rag/job-status/{job_id}")
async def rag_job_status(job_id: str):
    """Poll extraction job status. Returns text when done."""
    if job_id not in _jobs:
        raise HTTPException(404, f"Job {job_id} not found")
    job = _jobs[job_id]
    if job["status"] == "done":
        text = job["result"]
        # Clean up job after retrieval
        del _jobs[job_id]
        return {"status": "done", "text": text}
    elif job["status"] == "error":
        error = job["error"]
        del _jobs[job_id]
        raise HTTPException(500, f"Extraction failed: {error}")
    else:
        return {
            "status": "processing",
            "filename": job["filename"],
            "pages_done": job.get("pages_done", 0),
            "pages_total": job.get("pages_total", 0),
        }


async def _extract_pdf_via_qwen_vl(pdf_path: str, filename: str, job_id: str = "") -> str:
    """Convert each PDF page to image and send to Qwen2.5-VL."""
    import fitz
    import base64
    import httpx

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"  [EXTRACT-PDF] {filename}: {total_pages} pages via Qwen2.5-VL")

    if job_id and job_id in _jobs:
        _jobs[job_id]["pages_total"] = total_pages

    all_text = []

    for page_num in range(total_pages):
        page = doc[page_num]
        mat  = fitz.Matrix(72/72, 72/72)
        pix  = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        b64 = base64.b64encode(img_bytes).decode("utf-8")

        print(f"  [EXTRACT-PDF] Page {page_num + 1}/{total_pages}...")

        if job_id and job_id in _jobs:
            _jobs[job_id]["pages_done"] = page_num

        try:
            payload = {
                "model": LLM_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                        {"type": "text", "text": "Extract ALL text from this document page exactly as it appears. Preserve table structure using markdown pipe tables (| col | col |). Include all headings, paragraphs, numbers and table data. Output only the extracted text, no commentary."}
                    ]
                }],
                "max_tokens": 4000,
                "temperature": 0.1,
            }

            async with httpx.AsyncClient(timeout=300) as client:
                response = await client.post(
                    f"{LLM_BASE_URL}/chat/completions",
                    json=payload,
                    headers={"Authorization": "Bearer not-needed", "Content-Type": "application/json"}
                )
                response.raise_for_status()
                data = response.json()
                page_text = data["choices"][0]["message"]["content"]
                all_text.append(f"## Page {page_num + 1}\n\n{page_text}")
                print(f"  [EXTRACT-PDF] Page {page_num + 1}: {len(page_text)} chars")

        except Exception as e:
            print(f"  [EXTRACT-PDF] Page {page_num + 1} failed: {e}")
            fallback_text = page.get_text("text")
            if fallback_text.strip():
                all_text.append(f"## Page {page_num + 1}\n\n{fallback_text}")

    doc.close()
    combined = "\n\n".join(all_text)
    print(f"  [EXTRACT-PDF] Complete: {len(combined)} chars from {total_pages} pages")
    return combined


async def _extract_image_via_qwen_vl(image_path: str, filename: str) -> str:
    """Send a single image to Qwen2.5-VL for text extraction."""
    import base64
    import httpx

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    suffix = Path(image_path).suffix.lower().lstrip(".")
    mime   = "image/jpeg" if suffix in ("jpg", "jpeg") else f"image/{suffix}"

    payload = {
        "model": LLM_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": "Extract ALL text from this image exactly as it appears. Preserve table structure using markdown pipe tables. Output only the extracted text, no commentary."}
            ]
        }],
        "max_tokens": 4000,
        "temperature": 0.1,
    }

    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            json=payload,
            headers={"Authorization": "Bearer not-needed", "Content-Type": "application/json"}
        )
        response.raise_for_status()
        data = response.json()
        text = data["choices"][0]["message"]["content"]
        print(f"  [EXTRACT-IMAGE] {len(text)} chars from {filename}")
        return text


def _extract_docx_to_markdown(path: str) -> str:
    """Extract text from .docx preserving table structure as Markdown pipe tables."""
    from docx import Document
    from docx.oxml.ns import qn

    doc   = Document(path)
    lines = []

    def table_to_md(table) -> str:
        rows = []
        for i, row in enumerate(table.rows):
            cells = [c.text.replace("\n", " ").strip() for c in row.cells]
            rows.append("| " + " | ".join(cells) + " |")
            if i == 0:
                rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
        return "\n".join(rows)

    for child in doc.element.body:
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if tag == "p":
            para_text = "".join(
                node.text or ""
                for node in child.iter()
                if node.tag == qn("w:t")
            ).strip()
            if para_text:
                lines.append(para_text)
        elif tag == "tbl":
            for table in doc.tables:
                if table._tbl is child:
                    lines.append("")
                    lines.append(table_to_md(table))
                    lines.append("")
                    break

    return "\n".join(lines)



@app.post("/rag/index-rfp")
async def rag_index_rfp(
    file:        UploadFile = File(...),
    proposal_id: str        = Form(...),
):
    """
    Index a .docx RFP file into a per-proposal isolated workspace.
    Workspace name: rfp_<proposal_id>
    Returns { chunks: N, proposal_id: "...", workspace: "rfp_..." }

    Each proposal gets its own RAGAnything knowledge graph — zero bleed.
    """
    if not proposal_id.strip():
        raise HTTPException(400, "proposal_id is required")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    workspace  = f"rfp_{proposal_id.strip()}"
    suffix     = Path(file.filename or "rfp.docx").suffix.lower() or ".docx"
    output_dir = os.path.join(MINERU_OUTPUT, workspace)
    os.makedirs(output_dir, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        rag = await get_rag(workspace)
        print(f"  [INDEX-RFP] proposal={proposal_id} workspace={workspace}")

        await rag.process_document_complete(tmp_path, output_dir)

        # Count indexed chunk nodes as a proxy for "chunks"
        ws_dir = os.path.join(WORKSPACES_DIR, workspace)
        chunks = len([f for f in os.listdir(ws_dir) if f.endswith(".json")])

        print(f"  [INDEX-RFP] Done — chunks≈{chunks}")
        return {"chunks": chunks, "proposal_id": proposal_id, "workspace": workspace}

    finally:
        os.unlink(tmp_path)


@app.post("/rag/query-rfp")
async def rag_query_rfp(req: RfpQueryRequest):
    """
    Query a per-proposal workspace.
    Uses 'local' mode (dense chunk retrieval, no global graph traversal)
    to return raw context text rather than a synthesised answer.
    """
    if not req.question.strip() or not req.proposal_id.strip():
        raise HTTPException(400, "question and proposal_id are required")

    workspace = f"rfp_{req.proposal_id.strip()}"
    ws_dir    = os.path.join(WORKSPACES_DIR, workspace)

    if not os.path.isdir(ws_dir):
        print(f"  [QUERY-RFP] workspace {workspace} not found — returning empty")
        return {"context": "", "chunks": 0}

    rag    = await get_rag(workspace)
    # 'local' mode = retrieval-focused, no expensive global graph traversal
    answer = await rag.aquery(req.question.strip(), mode="local")

    print(f"  [QUERY-RFP] proposal={req.proposal_id} type={req.type} chars={len(answer)}")
    return {"context": answer or "", "chunks": 1 if answer else 0}


# ── Config endpoints ──────────────────────────────────────────

@app.get("/config")
async def config_get():
    return load_config()


@app.post("/config")
async def config_post(cfg: dict):
    save_config(cfg)
    print("\n💾 Config saved")
    return {"status": "saved", "config": cfg}


# ── Health ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "backend": "RAG-Anything"}


# ── Main ──────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "rag_anything_server:app",
        host="127.0.0.1",
        port=SERVER_PORT,
        log_level="info",
        reload=False,
    )