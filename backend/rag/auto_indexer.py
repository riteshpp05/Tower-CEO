# ============================================================
# auto_indexer.py  —  APNJ LLM Studio
# Watches all three data folders for new files.
# Automatically embeds and indexes any new file dropped in.
#
# Folders watched (from studio_config.json):
#   data\uploaded_docs\    PDF DOCX TXT  → apnj_documents
#   data\uploaded_excels\  XLSX XLSM CSV → apnj_excel
#   data\crawled_pages\    TXT web pages → apnj_web
#
# HOW TO USE:
#   Run this alongside your other servers.
#   Drop any file into a watched folder.
#   It indexes automatically within 2 seconds.
# ============================================================

import os
import re
import json
import time
import requests
import chromadb
import fitz
import pandas as pd

from docx import Document
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── CONFIG ───────────────────────────────────────────────────
CONFIG_FILE = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\studio_config.json"
BASE_DIR    = r"F:\Visual Code Directory\APNJ-LLM-Studio"

def load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except:
        return {}

cfg = load_config()

DOC_FOLDER     = cfg.get("doc_folder",
    os.path.join(BASE_DIR, "data", "uploaded_docs"))
EXCEL_FOLDER   = cfg.get("excel_folder",
    os.path.join(BASE_DIR, "data", "uploaded_excels"))
CRAWLED_FOLDER = cfg.get("crawled_folder",
    os.path.join(BASE_DIR, "data", "crawled_pages"))
CHROMA_FOLDER  = cfg.get("chroma_folder",
    os.path.join(BASE_DIR, "data", "chroma_db"))

EMBED_URL        = "http://127.0.0.1:8081/v1/embeddings"
DOC_COLLECTION   = "apnj_documents"
EXCEL_COLLECTION = "apnj_excel"
WEB_COLLECTION   = "apnj_web"

CHUNK_SIZE    = 1200
CHUNK_OVERLAP = 300
MIN_CHUNK     = 100

SKIP_SHEETS = ["Main Menu", "Benefit Projections"]
SKIP_LABELS = {
    "main menu","data inputs:","benefit opportunities:",
    "targeted benefits","nan","none",""
}


# ── SHARED UTILITIES ─────────────────────────────────────────

def get_embedding(text):
    try:
        r = requests.post(
            EMBED_URL,
            json={"model":"nomic-embed-text-v2-moe","input":text[:2000]},
            timeout=30
        )
        return r.json()["data"][0]["embedding"]
    except Exception as e:
        print(f"    Embedding error: {e}")
        return None


def get_collection(name):
    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    return client.get_or_create_collection(
        name=name, metadata={"hnsw:space":"cosine"}
    )


def store_chunks(chunks, collection_name):
    col    = get_collection(collection_name)
    stored = 0
    for chunk in chunks:
        if col.get(ids=[chunk["id"]])["ids"]:
            continue
        emb = get_embedding(chunk["text"])
        if emb is None:
            continue
        col.add(
            ids=[chunk["id"]],
            embeddings=[emb],
            documents=[chunk["text"]],
            metadatas=[chunk["metadata"]]
        )
        stored += 1
    total = get_collection(collection_name).count()
    return stored, total


def sentence_chunks(text, filename, ctype="doc"):
    """Split text into sentence-aware overlapping chunks."""
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z\[])', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    chunks, current, idx = [], "", 0
    for s in sentences:
        candidate = current + (" " if current else "") + s
        if len(candidate) > CHUNK_SIZE and current:
            if len(current.strip()) >= MIN_CHUNK:
                chunks.append({
                    "text": current.strip(),
                    "id":   f"{filename}__chunk_{idx}",
                    "metadata": {
                        "source":      filename,
                        "chunk_index": idx,
                        "type":        ctype
                    }
                })
                idx += 1
            ov = current[-CHUNK_OVERLAP:] if len(current) > CHUNK_OVERLAP else current
            m  = re.search(r'\.\s+([A-Z])', ov)
            current = (ov[m.start()+2:] + " " + s) if m else s
        else:
            current = candidate
    if current.strip() and len(current.strip()) >= MIN_CHUNK:
        chunks.append({
            "text": current.strip(),
            "id":   f"{filename}__chunk_{idx}",
            "metadata": {
                "source":      filename,
                "chunk_index": idx,
                "type":        ctype
            }
        })
    return chunks


# ── DOCUMENT INDEXER ─────────────────────────────────────────

def index_document(filepath):
    """Index a PDF/DOCX/TXT file into apnj_documents."""
    fname = os.path.basename(filepath)
    ext   = os.path.splitext(fname)[1].lower()
    print(f"\n  [DOCS] Indexing: {fname}")
    try:
        if ext == ".pdf":
            doc  = fitz.open(filepath)
            text = ""
            for pn, page in enumerate(doc):
                text += f"\n[Page {pn+1}]\n"
                tables = page.find_tables()
                trects = []
                if tables.tables:
                    for t in tables.tables:
                        trects.append(t.bbox)
                        try:
                            df = t.to_pandas()
                            h  = " | ".join(str(c) for c in df.columns)
                            text += "\n[TABLE]\n" + h + "\n"
                            for _, row in df.iterrows():
                                rt = " | ".join(str(v).strip() for v in row.values)
                                if rt.replace("|","").strip():
                                    text += rt + "\n"
                            text += "[/TABLE]\n\n"
                        except: pass
                for b in page.get_text("blocks"):
                    if not any(
                        fitz.Rect(b[:4]).intersects(fitz.Rect(r))
                        for r in trects
                    ):
                        if b[4].strip():
                            text += b[4].strip() + "\n"
            doc.close()

        elif ext == ".docx":
            d    = Document(filepath)
            text = ""
            for p in d.paragraphs:
                if p.text.strip():
                    prefix = "## " if p.style.name.startswith("Heading") else ""
                    text  += prefix + p.text.strip() + "\n"
            for table in d.tables:
                text += "\n[TABLE]\n"
                for row in table.rows:
                    text += " | ".join(c.text.strip() for c in row.cells) + "\n"
                text += "[/TABLE]\n\n"

        elif ext == ".txt":
            with open(filepath, encoding="utf-8", errors="ignore") as f:
                text = f.read()
        else:
            return

        if not text.strip():
            print(f"    Empty — skipping")
            return

        chunks         = sentence_chunks(text, fname)
        stored, total  = store_chunks(chunks, DOC_COLLECTION)
        print(f"    {len(chunks)} chunks → {stored} new | Total in DB: {total}")

    except Exception as e:
        print(f"    Failed: {e}")


# ── EXCEL INDEXER ────────────────────────────────────────────

def index_excel(filepath):
    """Index an Excel/CSV file into apnj_excel."""
    fname = os.path.basename(filepath)
    if fname.startswith("~"):   # skip Excel temp files
        return
    ext = os.path.splitext(fname)[1].lower()
    print(f"\n  [EXCEL] Indexing: {fname}")

    def cval(v):
        if pd.isna(v): return ""
        return str(int(v)) if isinstance(v,float) and v==int(v) else str(v).strip()

    all_chunks = []
    try:
        sheets = {}
        if ext == ".csv":
            sheets = {"CSV": pd.read_csv(filepath, dtype=str)}
        else:
            xl = pd.ExcelFile(filepath)
            sheets = {
                s: pd.read_excel(xl, sheet_name=s, header=None, dtype=str)
                for s in xl.sheet_names
                if s not in SKIP_SHEETS
            }

        for sname, df in sheets.items():
            sheet_chunks = 0
            for ridx, row in df.iterrows():
                label = cval(row.iloc[0]) if len(row) > 0 else ""
                if not label or label.lower() in SKIP_LABELS:
                    continue
                if len(label) < 8 or label.startswith("     "):
                    continue

                def gc(i):
                    v = cval(row.iloc[i]) if i < len(row) else ""
                    return "" if v.lower() in ["nan","none"] else v

                parts = [
                    f"File: {fname}",
                    f"Sheet: {sname}",
                    f"Item: {label}"
                ]
                for i, lbl in [
                    (1,"Units"),(2,"Cost"),(3,"Total"),
                    (5,"Conservative"),(6,"Most Likely"),(7,"Aggressive")
                ]:
                    v = gc(i)
                    if v and v not in ["0","0.00"]:
                        parts.append(f"{lbl}: {v}")

                if len(parts) >= 3:
                    all_chunks.append({
                        "text": " | ".join(parts),
                        "id":   f"{fname}__{sname}__row_{ridx}",
                        "metadata": {
                            "source": fname,
                            "sheet":  sname,
                            "row":    ridx,
                            "label":  label[:100]
                        }
                    })
                    sheet_chunks += 1
            if sheet_chunks:
                print(f"    {sname}: {sheet_chunks} chunks")

        stored, total = store_chunks(all_chunks, EXCEL_COLLECTION)
        print(f"    {len(all_chunks)} chunks → {stored} new | Total in DB: {total}")

    except Exception as e:
        print(f"    Failed: {e}")


# ── WEB PAGE INDEXER ─────────────────────────────────────────

def index_web_page(filepath):
    """Index a crawled web page .txt into apnj_web."""
    fname = os.path.basename(filepath)
    if fname == "crawl_list.txt":
        return
    print(f"\n  [WEB] Indexing: {fname}")
    try:
        with open(filepath, encoding="utf-8", errors="ignore") as f:
            text = f.read()
        url, title = "", ""
        for line in text.splitlines()[:6]:
            if line.startswith("SOURCE URL:"): url   = line[11:].strip()
            if line.startswith("TITLE:"):      title = line[6:].strip()
        lines   = text.splitlines()
        start   = next((i+1 for i,l in enumerate(lines) if "="*20 in l), 0)
        content = "\n".join(lines[start:])
        chunks  = sentence_chunks(content, fname, "web")
        for c in chunks:
            c["metadata"]["url"]   = url
            c["metadata"]["title"] = title
        stored, total = store_chunks(chunks, WEB_COLLECTION)
        print(f"    {len(chunks)} chunks → {stored} new | Total in DB: {total}")
    except Exception as e:
        print(f"    Failed: {e}")


# ── FILE WATCHER ─────────────────────────────────────────────

class FolderWatcher(FileSystemEventHandler):
    """
    Triggers on file creation or drag-and-drop (move).
    Debounce prevents double-triggers from OS file write events.
    """
    def __init__(self, folder_type):
        self.folder_type = folder_type
        self.last_seen   = {}

    def on_created(self, event):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_moved(self, event):
        # Drag-and-drop into folder = move event
        if not event.is_directory:
            self._handle(event.dest_path)

    def _handle(self, path):
        now = time.time()
        if path in self.last_seen and now - self.last_seen[path] < 3:
            return
        self.last_seen[path] = now
        time.sleep(1.5)   # wait for file write to complete

        ext = os.path.splitext(path)[1].lower()

        if self.folder_type == "docs":
            if ext in (".pdf", ".docx", ".txt"):
                index_document(path)

        elif self.folder_type == "excel":
            if ext in (".xlsx", ".xlsm", ".csv"):
                index_excel(path)

        elif self.folder_type == "web":
            if ext == ".txt" and "crawl_list" not in path:
                index_web_page(path)


# ── STARTUP: INDEX ANY UNINDEXED EXISTING FILES ──────────────

def index_existing_files():
    """
    On startup, check all watched folders for files that
    exist on disk but are not yet in ChromaDB.
    Indexes anything missing so the DB is always complete.
    """
    print("\nChecking for unindexed files...")

    # Documents
    if os.path.exists(DOC_FOLDER):
        for fname in os.listdir(DOC_FOLDER):
            if fname.lower().endswith((".pdf",".docx",".txt")):
                filepath = os.path.join(DOC_FOLDER, fname)
                col      = get_collection(DOC_COLLECTION)
                existing = col.get(where={"source": fname})
                if not existing["ids"]:
                    print(f"  Unindexed doc found: {fname}")
                    index_document(filepath)

    # Excel
    if os.path.exists(EXCEL_FOLDER):
        for fname in os.listdir(EXCEL_FOLDER):
            if fname.lower().endswith((".xlsx",".xlsm",".csv")) \
               and not fname.startswith("~"):
                filepath = os.path.join(EXCEL_FOLDER, fname)
                col      = get_collection(EXCEL_COLLECTION)
                existing = col.get(where={"source": fname})
                if not existing["ids"]:
                    print(f"  Unindexed Excel found: {fname}")
                    index_excel(filepath)

    print("  Startup check complete.")


# ── MAIN ─────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("APNJ Auto-Indexer")
    print("=" * 55)
    print(f"\nFolders watched:")
    print(f"  Docs   : {DOC_FOLDER}")
    print(f"  Excel  : {EXCEL_FOLDER}")
    print(f"  Web    : {CRAWLED_FOLDER}")

    # Check Nomic is up
    try:
        requests.get("http://127.0.0.1:8081/health", timeout=3)
        print(f"\n  Nomic-Embed ready on port 8081")
    except:
        print(f"\n  WARNING: Nomic-Embed not running!")
        print(f"  Files will not index until Nomic starts.")

    # Show current DB state
    print(f"\nCurrent index:")
    for name in [DOC_COLLECTION, EXCEL_COLLECTION, WEB_COLLECTION]:
        try:
            print(f"  {name}: {get_collection(name).count()} chunks")
        except:
            print(f"  {name}: 0 chunks")

    # Index any files that exist but aren't indexed yet
    index_existing_files()

    # Start watching folders
    print(f"\n{'='*55}")
    print(f"Watching for new files...")
    print(f"Drop any file into a watched folder to auto-index.")
    print(f"Ctrl+C to stop.")
    print(f"{'='*55}\n")

    observer = Observer()
    watched  = [
        (DOC_FOLDER,     "docs"),
        (EXCEL_FOLDER,   "excel"),
        (CRAWLED_FOLDER, "web"),
    ]
    for folder, ftype in watched:
        if os.path.exists(folder):
            observer.schedule(
                FolderWatcher(ftype), folder, recursive=False
            )
        else:
            print(f"Creating missing folder: {folder}")
            os.makedirs(folder, exist_ok=True)
            observer.schedule(
                FolderWatcher(ftype), folder, recursive=False
            )

    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        print("\nAuto-indexer stopped.")
    observer.join()


if __name__ == "__main__":
    main()
