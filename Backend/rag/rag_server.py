# ============================================================
# rag_server.py  — APNJ LLM Studio
# Local RAG server on port 3001
#
# Endpoints:
#   POST /rag/query        — search PDF/Word documents
#   POST /rag/excel        — search Excel data
#   POST /rag/web          — search crawled web pages
#   POST /rag/unified      — search ALL THREE simultaneously (NEW)
#   GET  /rag/status       — document DB status
#   GET  /rag/excel/status — Excel DB status
#   GET  /rag/web/status   — Web DB status
#   GET  /config           — read studio_config.json
#   POST /config           — save studio_config.json
#   POST /rag/scan-pdfs    — scan a URL for PDF links
#   POST /rag/download-pdfs— download selected PDFs
#   POST /rag/extract-docx  — extract Word doc to Markdown (table-safe)
#   POST /rag/index-rfp     — index RFP docx permanently with proposal_id tag
#   POST /rag/query-rfp     — query chunks filtered by proposal_id
# ============================================================

import io
import json
import os
import re
import tempfile
import requests
import chromadb
from docx import Document
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── PATHS ────────────────────────────────────────────────────
BASE_DIR    = r"F:\Visual Code Directory\APNJ-LLM-Studio"
CONFIG_FILE = os.path.join(BASE_DIR, "data", "studio_config.json")

DEFAULT_CONFIG = {
    "doc_folder":     os.path.join(BASE_DIR, "data", "uploaded_docs"),
    "excel_folder":   os.path.join(BASE_DIR, "data", "uploaded_excels"),
    "crawl_list":     os.path.join(BASE_DIR, "data", "crawled_pages", "crawl_list.txt"),
    "crawled_folder": os.path.join(BASE_DIR, "data", "crawled_pages"),
    "chroma_folder":  os.path.join(BASE_DIR, "data", "chroma_db")
}

# ── SETTINGS ─────────────────────────────────────────────────
COLLECTION       = "apnj_documents"
EXCEL_COLLECTION = "apnj_excel"
WEB_COLLECTION   = "apnj_web"
EMBED_URL        = "http://127.0.0.1:8081/v1/embeddings"
CHAT_URL         = "http://127.0.0.1:8080/v1/chat/completions"
RAG_PORT         = 3001
TOP_K            = 5
UNIFIED_TOP_K    = 2    # Top results per collection in unified mode
                        # 2 x 3 collections = 6 chunks total
                        # Keeps prompt within Gemma's context window
MIN_RELEVANCE    = 35   # Only include chunks above this % relevance
                        # Prevents noise from unrelated collections
MAX_CHUNK_CHARS  = 800  # Trim each chunk before sending to Gemma


# ── CONFIG ───────────────────────────────────────────────────

def load_config():
    if not os.path.exists(CONFIG_FILE):
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        for k, v in DEFAULT_CONFIG.items():
            if k not in cfg:
                cfg[k] = v
        return cfg
    except Exception as e:
        print(f"Config read error: {e}")
        return DEFAULT_CONFIG.copy()


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def get_chroma_folder():
    return load_config().get("chroma_folder", DEFAULT_CONFIG["chroma_folder"])


# ── EMBEDDING & SEARCH ───────────────────────────────────────

def get_embedding(text):
    """Convert text to 768-number vector using Nomic-Embed."""
    payload = {
        "model": "nomic-embed-text-v2-moe",
        "input": text[:2000]
    }
    response = requests.post(EMBED_URL, json=payload, timeout=30)
    data = response.json()
    return data["data"][0]["embedding"]


def search_collection(question, collection_name, top_k=TOP_K):
    """Search one ChromaDB collection. Returns chunks, metadatas, distances."""
    chroma_folder = get_chroma_folder()
    client = chromadb.PersistentClient(path=chroma_folder)
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"}
    )
    if collection.count() == 0:
        return [], [], []
    question_embedding = get_embedding(question)
    results = collection.query(
        query_embeddings=[question_embedding],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"]
    )
    return (
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0]
    )


def search_unified(question):
    """
    Search ALL THREE collections simultaneously.

    HOW IT WORKS:
    1. Convert question to embedding ONCE (reused for all 3 searches)
       This saves time vs embedding 3 separate times
    2. Search docs, excel, web with UNIFIED_TOP_K results each
    3. Filter out low-relevance results (below MIN_RELEVANCE %)
    4. Return combined list sorted by relevance

    WHY TOP 2 PER COLLECTION?
    2 chunks x 3 collections = 6 chunks total
    6 x 800 chars = 4800 chars = ~1200 tokens input
    Leaves ~2800 tokens for Gemma's answer in 4096 context window

    WHY MIN_RELEVANCE FILTER?
    If you ask about Excel data, the web chunks may score 20-30%
    (technically "found something" but unrelated noise).
    Filtering at 35% ensures only genuinely relevant results
    from each collection make it into the prompt.
    """
    chroma_folder = get_chroma_folder()
    client = chromadb.PersistentClient(path=chroma_folder)

    # Get embedding once — reuse for all searches
    question_embedding = get_embedding(question)

    all_results = []

    collections_to_search = [
        (COLLECTION,       "document", "📄"),
        (EXCEL_COLLECTION, "excel",    "📊"),
        (WEB_COLLECTION,   "web",      "🌐"),
    ]

    for coll_name, coll_type, icon in collections_to_search:
        try:
            coll = client.get_or_create_collection(
                name=coll_name,
                metadata={"hnsw:space": "cosine"}
            )
            if coll.count() == 0:
                continue

            results = coll.query(
                query_embeddings=[question_embedding],
                n_results=min(UNIFIED_TOP_K, coll.count()),
                include=["documents", "metadatas", "distances"]
            )

            for doc, meta, dist in zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0]
            ):
                relevance = round((1 - dist) * 100, 1)
                if relevance >= MIN_RELEVANCE:
                    all_results.append({
                        "text":      doc,
                        "metadata":  meta,
                        "relevance": relevance,
                        "type":      coll_type,
                        "icon":      icon
                    })
        except Exception as e:
            print(f"  Search failed for {coll_name}: {e}")
            continue

    # Sort by relevance — best results first
    all_results.sort(key=lambda x: x["relevance"], reverse=True)
    return all_results


# ── PROMPT BUILDERS ──────────────────────────────────────────

def build_prompt(question, chunks, metadatas):
    """Standard prompt for single-collection queries."""
    context_parts = []
    for i, (chunk, meta) in enumerate(zip(chunks, metadatas)):
        source = meta.get("source", "Unknown")
        sheet  = meta.get("sheet", "")
        url    = meta.get("url", "")
        if url:
            label = f"'{source}' from {url}"
        elif sheet:
            label = f"'{source}' Sheet: {sheet}"
        else:
            label = f"'{source}'"
        trimmed = chunk[:MAX_CHUNK_CHARS]
        context_parts.append(f"[Excerpt {i+1} from {label}]\n{trimmed}")

    context = "\n\n---\n\n".join(context_parts)
    return f"""You are a helpful assistant. Answer the question using ONLY the excerpts below.
Give a complete, detailed answer. If the answer is not in the excerpts, say so clearly.

EXCERPTS:
{context}

QUESTION: {question}

ANSWER:"""


def build_unified_prompt(question, results):
    """
    Build prompt for unified search across all collections.

    Groups results by type (documents/excel/web) with clear labels
    so Gemma knows where each piece of information came from.
    """
    if not results:
        return None

    context_parts = []
    for i, r in enumerate(results):
        meta   = r["metadata"]
        source = meta.get("source", "Unknown")
        sheet  = meta.get("sheet", "")
        url    = meta.get("url", "")
        rtype  = r["type"]
        icon   = r["icon"]

        if rtype == "excel" and sheet:
            label = f"{icon} Excel: '{source}' Sheet: {sheet}"
        elif rtype == "web" and url:
            label = f"{icon} Web: '{source}' ({url[:60]})"
        else:
            label = f"{icon} Document: '{source}'"

        trimmed = r["text"][:MAX_CHUNK_CHARS]
        context_parts.append(
            f"[Source {i+1}: {label}]\n{trimmed}"
        )

    context = "\n\n---\n\n".join(context_parts)

    return f"""You are a helpful AI assistant with access to the user's private knowledge base.
Answer the question using the excerpts provided below from the user's documents, spreadsheets and web pages.
Synthesise information from multiple sources if relevant.
If the answer is not found in any excerpt, say so and offer what general knowledge you have.

KNOWLEDGE BASE EXCERPTS:
{context}

QUESTION: {question}

ANSWER:"""


def ask_gemma(prompt):
    """Send prompt to Gemma and return answer text."""
    payload = {
        "model": "gemma",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 1024
    }
    try:
        response = requests.post(CHAT_URL, json=payload, timeout=90)
        data = response.json()
        answer = data["choices"][0]["message"]["content"]
        return answer if answer else "Gemma returned an empty response."
    except Exception as e:
        return f"Error contacting Gemma: {e}"


def get_collection_count(collection_name):
    try:
        chroma_folder = get_chroma_folder()
        client = chromadb.PersistentClient(path=chroma_folder)
        col = client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        return col.count()
    except Exception:
        return 0


# ── PDF SCANNER ──────────────────────────────────────────────

def scan_page_for_pdfs(url):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        if response.status_code != 200:
            return {"error": f"HTTP {response.status_code}", "pdfs": []}

        soup = BeautifulSoup(response.text, "html.parser")
        base_url = f"{urlparse(url).scheme}://{urlparse(url).netloc}"

        pdfs = []
        seen = set()

        for link in soup.find_all("a", href=True):
            href = link["href"].strip()
            if not href.lower().endswith(".pdf"):
                continue
            if href.startswith("http"):
                pdf_url = href
            elif href.startswith("//"):
                pdf_url = "https:" + href
            elif href.startswith("/"):
                pdf_url = base_url + href
            else:
                pdf_url = urljoin(url, href)
            if pdf_url in seen:
                continue
            seen.add(pdf_url)
            link_text = link.get_text().strip()[:80] or os.path.basename(pdf_url)
            pdfs.append({
                "url":      pdf_url,
                "filename": os.path.basename(urlparse(pdf_url).path) or "document.pdf",
                "title":    link_text
            })

        return {"source_url": url, "pdfs_found": len(pdfs), "pdfs": pdfs[:50]}
    except Exception as e:
        return {"error": str(e), "pdfs": []}


def download_pdf_as_text(pdf_url, save_folder):
    import fitz
    from datetime import datetime
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36"
    }
    response = requests.get(pdf_url, headers=headers, timeout=30, allow_redirects=True)
    if response.status_code != 200:
        return False, f"HTTP {response.status_code}"

    filename  = os.path.basename(urlparse(pdf_url).path)
    safe_name = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    txt_path  = os.path.join(save_folder, safe_name.replace(".pdf", ".txt"))

    doc  = fitz.open(stream=response.content, filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    doc.close()

    if not text.strip():
        return False, "PDF appears to be image-only (no extractable text)"

    content = f"""SOURCE URL: {pdf_url}
TITLE: {filename}
DESCRIPTION: PDF downloaded from web
CRAWLED: {datetime.now().strftime('%Y-%m-%d %H:%M')}
{'='*60}

{text[:50000]}
"""
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content)
    return True, txt_path


# ── REQUEST HANDLER ──────────────────────────────────────────


# ── DOCX EXTRACTION ──────────────────────────────────────────────────

def extract_docx_to_markdown(filepath):
    """
    Extract a .docx file to clean Markdown, preserving table structure.

    Iterates doc.element.body children in document order so paragraphs
    and tables appear in their original sequence (not appended at end).

    Paragraphs -> plain text; headings get ## prefix
    Tables     -> Markdown pipe table with header separator row
    """
    WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

    doc   = Document(filepath)
    lines = []

    for child in doc.element.body:
        tag = child.tag.split('}')[-1]   # strip XML namespace

        if tag == 'p':
            para_text = ''.join(
                node.text or ''
                for node in child.iter()
                if node.tag.endswith('}t')
            ).strip()
            if not para_text:
                continue
            style_elem = child.find(f'{{{WNS}}}pPr/{{{WNS}}}pStyle')
            style_val  = style_elem.get(f'{{{WNS}}}val', '') if style_elem is not None else ''
            if 'heading' in style_val.lower():
                lines.append(f'\n## {para_text}')
            else:
                lines.append(para_text)

        elif tag == 'tbl':
            rows = []
            for tr in child.findall(f'{{{WNS}}}tr'):
                cells = []
                for tc in tr.findall(f'{{{WNS}}}tc'):
                    cell_text = ''.join(
                        node.text or ''
                        for node in tc.iter()
                        if node.tag.endswith('}t')
                    ).strip().replace('\n', ' ')
                    cells.append(cell_text)
                if any(c.strip() for c in cells):
                    rows.append(cells)

            if not rows:
                continue

            # Normalise all rows to same column count
            max_cols = max(len(r) for r in rows)
            rows = [r + [''] * (max_cols - len(r)) for r in rows]

            lines.append('')
            lines.append('| ' + ' | '.join(rows[0]) + ' |')
            lines.append('| ' + ' | '.join(['---'] * max_cols) + ' |')
            for row in rows[1:]:
                lines.append('| ' + ' | '.join(row) + ' |')
            lines.append('')

    return '\n'.join(lines)


# ── SIMPLE CHUNKER for RFP indexing ──────────────────────────────────────────

CHUNK_SIZE    = 1200
CHUNK_OVERLAP = 200
MIN_CHUNK     = 80

def chunk_text_simple(text, source_id):
    """Simple sentence-aware chunker used for RFP indexing."""
    import re
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z\[])', text)
    chunks = []
    current = ""
    idx = 0
    for sentence in sentences:
        candidate = current + (" " if current else "") + sentence
        if len(candidate) > CHUNK_SIZE and current:
            if len(current.strip()) >= MIN_CHUNK:
                chunks.append({
                    "text": current.strip(),
                    "id": f"{source_id}__chunk_{idx}",
                    "metadata": {"source": source_id, "chunk_index": idx}
                })
                idx += 1
            overlap = current[-CHUNK_OVERLAP:] if len(current) > CHUNK_OVERLAP else current
            current = sentence
        else:
            current = candidate
    if current.strip() and len(current.strip()) >= MIN_CHUNK:
        chunks.append({
            "text": current.strip(),
            "id": f"{source_id}__chunk_{idx}",
            "metadata": {"source": source_id, "chunk_index": idx}
        })
    return chunks


def get_embedding_local(text):
    """Embed text via Nomic on port 8081."""
    try:
        r = requests.post(
            "http://127.0.0.1:8081/v1/embeddings",
            json={"model": "nomic-embed-text-v2-moe", "input": text[:2000]},
            timeout=30
        )
        return r.json()["data"][0]["embedding"]
    except Exception as e:
        print(f"    Embedding failed: {e}")
        return None

class RAGHandler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/rag/status":
            self._handle_status(COLLECTION)
        elif self.path == "/rag/excel/status":
            self._handle_status(EXCEL_COLLECTION)
        elif self.path == "/rag/web/status":
            self._handle_status(WEB_COLLECTION)
        elif self.path == "/config":
            self._handle_config_get()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/rag/query":
            self._handle_query(COLLECTION, "document")
        elif self.path == "/rag/excel":
            self._handle_query(EXCEL_COLLECTION, "excel")
        elif self.path == "/rag/web":
            self._handle_query(WEB_COLLECTION, "web")
        elif self.path == "/rag/unified":
            self._handle_unified()
        elif self.path == "/config":
            self._handle_config_post()
        elif self.path == "/rag/scan-pdfs":
            self._handle_scan_pdfs()
        elif self.path == "/rag/download-pdfs":
            self._handle_download_pdfs()
        elif self.path == "/rag/extract-docx":
            self._handle_extract_docx()
        elif self.path == "/rag/index-rfp":
            self._handle_index_rfp()
        elif self.path == "/rag/query-rfp":
            self._handle_query_rfp()
        else:
            self.send_response(404)
            self.end_headers()

    # ── UNIFIED HANDLER ──────────────────────────────────────

    def _handle_unified(self):
        """
        The main unified search handler.
        Searches all 3 collections and returns combined answer + sources.
        Called by Chat tab for every message.
        """
        try:
            length   = int(self.headers["Content-Length"])
            body     = self.rfile.read(length)
            data     = json.loads(body)
            question = data.get("question", "").strip()

            if not question:
                self._send_json({"error": "No question provided"}, 400)
                return

            print(f"\n🔮 UNIFIED Search: {question}")
            print("🔍 Searching docs + excel + web...")

            results = search_unified(question)

            if not results:
                # No relevant results found — return signal to
                # browser so it can fall back to pure Gemma chat
                print("   No relevant results — pure chat mode")
                self._send_json({
                    "answer":        None,
                    "sources":       [],
                    "chunks_used":   0,
                    "has_context":   False
                })
                return

            # Show what was found
            for r in results:
                print(f"   {r['icon']} {r['type']:8} {r['relevance']}%  {r['metadata'].get('source','?')[:40]}")

            prompt = build_unified_prompt(question, results)
            print(f"🤖 Asking Gemma with {len(results)} combined chunks...")
            answer = ask_gemma(prompt)

            # Build source list for browser
            sources = []
            for r in results:
                meta  = r["metadata"]
                sheet = meta.get("sheet", "")
                url   = meta.get("url", "")
                if sheet:
                    where = f"Excel — {sheet}"
                elif url:
                    where = url[:50]
                else:
                    where = meta.get("source", "Unknown")
                sources.append({
                    "file":      meta.get("source", "Unknown"),
                    "where":     where,
                    "type":      r["type"],
                    "icon":      r["icon"],
                    "relevance": r["relevance"]
                })

            print("✅ Unified answer ready")
            self._send_json({
                "answer":      answer,
                "sources":     sources,
                "chunks_used": len(results),
                "has_context": True
            })

        except Exception as e:
            print(f"❌ Unified error: {e}")
            self._send_json({"error": str(e)}, 500)

    # ── SINGLE COLLECTION HANDLER ────────────────────────────

    def _handle_query(self, collection_name, query_type):
        try:
            length   = int(self.headers["Content-Length"])
            body     = self.rfile.read(length)
            data     = json.loads(body)
            question = data.get("question", "").strip()

            if not question:
                self._send_json({"error": "No question provided"}, 400)
                return

            icons = {"excel": "📊", "web": "🌐", "document": "📥"}
            print(f"\n{icons.get(query_type,'📥')} {query_type.upper()}: {question}")

            chunks, metadatas, distances = search_collection(question, collection_name)

            if not chunks:
                msgs = {
                    "excel":    "No Excel data. Run excel_processor.py first.",
                    "web":      "No web pages. Run web_crawler.py + web_indexer.py first.",
                    "document": "No documents. Run doc_processor.py first."
                }
                self._send_json({
                    "answer": msgs.get(query_type, "No data found."),
                    "sources": [], "chunks_used": 0
                })
                return

            prompt = build_prompt(question, chunks, metadatas)
            answer = ask_gemma(prompt)

            sources = []
            for meta, dist in zip(metadatas, distances):
                sheet = meta.get("sheet", "")
                url   = meta.get("url", "")
                section = f"Sheet: {sheet} | Row: {meta.get('row','?')}" if sheet \
                     else url[:60] if url \
                     else str(meta.get("chunk_index", ""))
                sources.append({
                    "file":      meta.get("source", "Unknown"),
                    "section":   section,
                    "relevance": round((1 - dist) * 100, 1)
                })

            self._send_json({
                "answer": answer, "sources": sources,
                "chunks_used": len(chunks)
            })

        except Exception as e:
            print(f"❌ Error: {e}")
            self._send_json({"error": str(e)}, 500)

    # ── STATUS HANDLER ───────────────────────────────────────

    def _handle_status(self, collection_name):
        try:
            count = get_collection_count(collection_name)
            self._send_json({
                "status": "ready", "chunks_in_db": count,
                "collection": collection_name
            })
        except Exception as e:
            self._send_json({"status": "error", "message": str(e)}, 500)

    # ── CONFIG HANDLERS ──────────────────────────────────────

    def _handle_config_get(self):
        try:
            self._send_json(load_config())
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    def _handle_config_post(self):
        try:
            length  = int(self.headers["Content-Length"])
            body    = self.rfile.read(length)
            new_cfg = json.loads(body)
            save_config(new_cfg)
            print(f"\n💾 Config saved")
            self._send_json({"status": "saved", "config": new_cfg})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ── PDF HANDLERS ─────────────────────────────────────────

    def _handle_scan_pdfs(self):
        try:
            length = int(self.headers["Content-Length"])
            body   = self.rfile.read(length)
            data   = json.loads(body)
            url    = data.get("url", "").strip()
            if not url:
                self._send_json({"error": "No URL provided"}, 400)
                return
            print(f"\n🔍 Scanning: {url}")
            result = scan_page_for_pdfs(url)
            print(f"   Found {result.get('pdfs_found', 0)} PDFs")
            self._send_json(result)
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    def _handle_download_pdfs(self):
        try:
            length = int(self.headers["Content-Length"])
            body   = self.rfile.read(length)
            data   = json.loads(body)
            urls   = data.get("urls", [])
            cfg    = load_config()
            folder = cfg.get("crawled_folder", DEFAULT_CONFIG["crawled_folder"])
            results = []
            for pdf_url in urls:
                print(f"\n📥 Downloading: {pdf_url}")
                try:
                    ok, result = download_pdf_as_text(pdf_url, folder)
                    results.append({
                        "url": pdf_url,
                        "status": "success" if ok else "failed",
                        "file" if ok else "error": result
                    })
                    print(f"   {'✅' if ok else '❌'} {result}")
                except Exception as e:
                    results.append({"url": pdf_url, "status": "error", "error": str(e)})
            success = sum(1 for r in results if r["status"] == "success")
            self._send_json({
                "downloaded": success, "total": len(urls), "results": results,
                "message": f"Downloaded {success}/{len(urls)} PDFs. Click Re-index to make searchable."
            })
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ── DOCX EXTRACT HANDLER ─────────────────────────────────

    def _handle_extract_docx(self):
        """
        POST /rag/extract-docx
        Accept multipart/form-data with a .docx file field named "file".
        Returns { "text": "<markdown string>" }

        Single extraction point for all RFP documents.
        Frontend calls this instead of using mammoth locally.
        Tables are preserved as Markdown pipe tables, not dropped.
        """
        try:
            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self._send_json({"error": "Expected multipart/form-data"}, 400)
                return

            # Parse boundary from Content-Type header
            boundary = None
            for part in content_type.split(";"):
                part = part.strip()
                if part.startswith("boundary="):
                    boundary = part[9:].strip().encode()
                    break

            if not boundary:
                self._send_json({"error": "No multipart boundary found"}, 400)
                return

            length   = int(self.headers.get("Content-Length", 0))
            body     = self.rfile.read(length)

            # Find the file part in the multipart body
            file_data = None
            for part in body.split(b"--" + boundary):
                if b"Content-Disposition" in part and b"filename=" in part:
                    header_end = part.find(b"\r\n\r\n")
                    if header_end == -1:
                        continue
                    file_data = part[header_end + 4:]
                    if file_data.endswith(b"\r\n"):
                        file_data = file_data[:-2]
                    break

            if not file_data:
                self._send_json({"error": "No file found in upload"}, 400)
                return

            # Write to temp file — python-docx needs a real file path
            with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
                tmp.write(file_data)
                tmp_path = tmp.name

            try:
                text = extract_docx_to_markdown(tmp_path)
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

            if not text.strip():
                self._send_json(
                    {"error": "Document appears empty or unreadable"}, 422
                )
                return

            print(f"  [EXTRACT-DOCX] {len(text)} chars returned")
            self._send_json({"text": text})

        except Exception as e:
            print(f"  [EXTRACT-DOCX] Error: {e}")
            self._send_json({"error": str(e)}, 500)

    # ── INDEX RFP HANDLER ────────────────────────────────────

    def _handle_index_rfp(self):
        """
        POST /rag/index-rfp
        Multipart form: file (.docx) + proposal_id (string)

        Extracts the docx to Markdown, chunks it, embeds each chunk,
        and stores in apnj_documents with metadata { proposal_id: "..." }
        so future /rag/query-rfp calls can filter to this proposal only.
        """
        try:
            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self._send_json({"error": "Expected multipart/form-data"}, 400)
                return

            boundary = None
            for part in content_type.split(";"):
                part = part.strip()
                if part.startswith("boundary="):
                    boundary = part[9:].strip().encode()
                    break
            if not boundary:
                self._send_json({"error": "No multipart boundary"}, 400)
                return

            length   = int(self.headers.get("Content-Length", 0))
            body     = self.rfile.read(length)
            parts    = body.split(b"--" + boundary)

            file_data   = None
            proposal_id = None

            for part in parts:
                if b"Content-Disposition" not in part:
                    continue
                header_end = part.find(b"\r\n\r\n")
                if header_end == -1:
                    continue
                headers_raw = part[:header_end].decode("utf-8", errors="ignore")
                content     = part[header_end + 4:]
                if content.endswith(b"\r\n"):
                    content = content[:-2]

                if b'filename=' in part[:header_end]:
                    file_data = content
                elif 'name="proposal_id"' in headers_raw or "name=\'proposal_id\'" in headers_raw:
                    proposal_id = content.decode("utf-8", errors="ignore").strip()

            if not file_data:
                self._send_json({"error": "No file in upload"}, 400)
                return
            if not proposal_id:
                self._send_json({"error": "No proposal_id in upload"}, 400)
                return

            with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
                tmp.write(file_data)
                tmp_path = tmp.name

            try:
                text = extract_docx_to_markdown(tmp_path)
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

            if not text.strip():
                self._send_json({"error": "Document empty or unreadable"}, 422)
                return

            # Chunk using same logic as doc_processor
            chunks = chunk_text_simple(text, proposal_id)

            client     = chromadb.PersistentClient(path=CHROMA_FOLDER)
            collection = client.get_or_create_collection(
                name="apnj_documents",
                metadata={"hnsw:space": "cosine"}
            )

            stored = 0
            for chunk in chunks:
                emb = get_embedding_local(chunk["text"])
                if emb is None:
                    continue
                chunk_id = f"{proposal_id}__{chunk['id']}"
                collection.upsert(
                    ids        = [chunk_id],
                    embeddings = [emb],
                    documents  = [chunk["text"]],
                    metadatas  = [{"source": chunk["id"], "proposal_id": proposal_id,
                                   "chunk_index": chunk["metadata"]["chunk_index"]}]
                )
                stored += 1

            print(f"  [INDEX-RFP] proposal={proposal_id} chunks={stored}")
            self._send_json({"chunks": stored, "proposal_id": proposal_id})

        except Exception as e:
            print(f"  [INDEX-RFP] Error: {e}")
            self._send_json({"error": str(e)}, 500)

    # ── QUERY RFP HANDLER ────────────────────────────────────

    def _handle_query_rfp(self):
        """
        POST /rag/query-rfp
        Body: { "question": "...", "proposal_id": "...", "type": "resources|hardware|other|scope" }

        Searches apnj_documents filtered by proposal_id metadata.
        Returns { "context": "<concatenated relevant chunks>" }
        No LLM call — just retrieves the most relevant chunks as raw text.
        """
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length).decode("utf-8"))

            question    = body.get("question", "").strip()
            proposal_id = body.get("proposal_id", "").strip()
            query_type  = body.get("type", "scope")

            if not question or not proposal_id:
                self._send_json({"error": "question and proposal_id are required"}, 400)
                return

            emb = get_embedding_local(question[:2000])
            if emb is None:
                self._send_json({"context": ""})
                return

            client     = chromadb.PersistentClient(path=CHROMA_FOLDER)
            collection = client.get_or_create_collection(
                name="apnj_documents",
                metadata={"hnsw:space": "cosine"}
            )

            results = collection.query(
                query_embeddings = [emb],
                n_results        = 6,
                where            = {"proposal_id": proposal_id},
                include          = ["documents", "distances"]
            )

            docs = results.get("documents", [[]])[0]
            context = "\n\n".join(docs) if docs else ""

            print(f"  [QUERY-RFP] proposal={proposal_id} type={query_type} chunks={len(docs)}")
            self._send_json({"context": context, "chunks": len(docs)})

        except Exception as e:
            print(f"  [QUERY-RFP] Error: {e}")
            self._send_json({"context": "", "error": str(e)})

    # ── HELPERS ──────────────────────────────────────────────

    def _send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format, *args):
        print(f"  [{self.address_string()}] {format % args}")


# ── MAIN ─────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("APNJ RAG Server — Unified Intelligence Edition")
    print("=" * 55)
    print(f"\nPort     : {RAG_PORT}")
    print(f"Config   : {CONFIG_FILE}")
    print(f"\nEndpoints:")
    print(f"  POST /rag/unified      — Search ALL collections (Chat)")
    print(f"  POST /rag/query        — Documents only")
    print(f"  POST /rag/excel        — Excel only")
    print(f"  POST /rag/web          — Web pages only")
    print(f"  GET  /rag/status       — Document DB")
    print(f"  GET  /rag/excel/status — Excel DB")
    print(f"  GET  /rag/web/status   — Web DB")
    print(f"  GET  /config           — Read config")
    print(f"  POST /config           — Save config")
    print(f"  POST /rag/scan-pdfs    — Scan URL for PDFs")
    print(f"  POST /rag/download-pdfs— Download PDFs")
    print(f"  POST /rag/extract-docx — Extract Word doc to Markdown")
    print(f"  POST /rag/index-rfp    — Index RFP with proposal_id tag")
    print(f"  POST /rag/query-rfp    — Query RFP chunks by proposal_id")

    doc_count   = get_collection_count(COLLECTION)
    excel_count = get_collection_count(EXCEL_COLLECTION)
    web_count   = get_collection_count(WEB_COLLECTION)
    total       = doc_count + excel_count + web_count

    print(f"\nKnowledge Base:")
    print(f"  Documents : {doc_count} chunks")
    print(f"  Excel     : {excel_count} chunks")
    print(f"  Web       : {web_count} chunks")
    print(f"  TOTAL     : {total} chunks searchable")
    print(f"\nWaiting for requests...\n")

    server = HTTPServer(("127.0.0.1", RAG_PORT), RAGHandler)
    server.serve_forever()