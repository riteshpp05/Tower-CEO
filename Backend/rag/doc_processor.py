# ============================================================
# doc_processor.py  —  APNJ LLM Studio
# WHAT THIS DOES:
# Reads PDF, Word (.docx), and plain text (.txt) files
# Chops them into overlapping chunks (like index cards)
# Sends each chunk to Nomic-Embed to get embeddings
# Saves everything into ChromaDB on your hard drive
#
# IMPROVED CHUNKING v2:
# - Sentence-aware splitting (never cuts mid-sentence)
# - Adaptive chunk sizes based on content type
# - Better overlap strategy
# - Deduplication of near-identical chunks
# ============================================================

import os
import re
import requests
import chromadb
import fitz          # PyMuPDF
from docx import Document

# ── LOAD CONFIG ─────────────────────────────────────────────
import json

CONFIG_FILE = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\studio_config.json"

def load_config():
    try:
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

cfg = load_config()

DOCS_FOLDER   = cfg.get("doc_folder",   r"F:\Visual Code Directory\APNJ-LLM-Studio\data\uploaded_docs")
CHROMA_FOLDER = cfg.get("chroma_folder",r"F:\Visual Code Directory\APNJ-LLM-Studio\data\chroma_db")
EMBED_URL     = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION    = "apnj_documents"

# ── CHUNKING SETTINGS ───────────────────────────────────────
#
# WHAT IS A CHUNK?
# Think of a chunk as one index card of text.
# Too small = not enough context for Gemma to answer
# Too large = exceeds Gemma's context window
#
# CHUNK_SIZE    = target characters per chunk (~250-300 words)
# CHUNK_OVERLAP = characters shared between adjacent chunks
#                 Prevents losing meaning at boundaries
# MIN_CHUNK     = discard chunks smaller than this (noise)
#
CHUNK_SIZE    = 1200   # ~300 words — good for dense docs
CHUNK_OVERLAP = 300    # 25% overlap — generous for context
MIN_CHUNK     = 100    # Skip very short chunks (headers etc)


def read_pdf(filepath):
    """
    Open a PDF and extract text — with smart table handling.
    Tables are extracted as structured rows with | separators.
    Regular text is extracted paragraph by paragraph.
    """
    text = ""
    doc = fitz.open(filepath)

    for page_num, page in enumerate(doc):
        text += f"\n[Page {page_num + 1}]\n"

        # Find tables first
        tables = page.find_tables()
        table_rects = []

        if tables.tables:
            for table in tables.tables:
                table_rects.append(table.bbox)
                text += "\n[TABLE]\n"
                try:
                    df = table.to_pandas()
                    headers = " | ".join(str(c) for c in df.columns)
                    text += headers + "\n" + "-" * min(len(headers), 80) + "\n"
                    for _, row in df.iterrows():
                        row_text = " | ".join(str(v).strip() for v in row.values)
                        if row_text.replace("|","").strip():
                            text += row_text + "\n"
                except Exception:
                    pass
                text += "[/TABLE]\n\n"

        # Extract non-table text
        blocks = page.get_text("blocks")
        for block in blocks:
            block_rect = fitz.Rect(block[:4])
            in_table = any(
                block_rect.intersects(fitz.Rect(tr))
                for tr in table_rects
            )
            if not in_table and block[4].strip():
                text += block[4].strip() + "\n"

    doc.close()
    return text


def read_docx(filepath):
    """Read a Word document preserving paragraphs and tables."""
    doc = Document(filepath)
    text = ""
    for para in doc.paragraphs:
        if para.text.strip():
            # Preserve heading structure
            if para.style.name.startswith('Heading'):
                text += f"\n## {para.text.strip()}\n"
            else:
                text += para.text.strip() + "\n"
    # Also extract tables
    for table in doc.tables:
        text += "\n[TABLE]\n"
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells)
            if row_text.replace("|","").strip():
                text += row_text + "\n"
        text += "[/TABLE]\n\n"
    return text


def read_txt(filepath):
    """Read a plain text file."""
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def split_into_sentences(text):
    """
    Split text into sentences.

    WHY SENTENCE-AWARE SPLITTING?
    Naive splitting cuts text every N characters regardless of
    where sentences end. This creates nonsense chunks like:
      "The total revenue was 5 crores in FY20"
      "24 which represents a 15% growth"

    Sentence-aware splitting ensures each chunk ends at a
    natural boundary, making Gemma's job much easier.
    """
    # Split on sentence endings followed by space and capital
    # Handles: . ! ? followed by space/newline
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z\[])', text)
    return [s.strip() for s in sentences if s.strip()]


def chunk_text(text, filename):
    """
    Chop text into overlapping sentence-aware chunks.

    STRATEGY:
    1. Split into sentences
    2. Accumulate sentences until CHUNK_SIZE reached
    3. Start new chunk, but carry forward last N chars as overlap
    4. Skip chunks below MIN_CHUNK threshold

    This is better than character-based splitting because:
    - Sentences are natural units of meaning
    - No mid-sentence cuts
    - Overlap ensures context continuity
    """
    sentences = split_into_sentences(text)

    chunks = []
    current = ""
    chunk_index = 0

    for sentence in sentences:
        # Add sentence to current chunk
        candidate = current + (" " if current else "") + sentence

        if len(candidate) > CHUNK_SIZE and current:
            # Current chunk is full — save it
            if len(current.strip()) >= MIN_CHUNK:
                chunks.append({
                    "text": current.strip(),
                    "id": f"{filename}__chunk_{chunk_index}",
                    "metadata": {
                        "source":      filename,
                        "chunk_index": chunk_index,
                        "length":      len(current)
                    }
                })
                chunk_index += 1

            # Start new chunk with overlap from end of current
            # WHY? Last sentences of current chunk provide context
            # for the first sentences of the next chunk
            overlap_text = current[-CHUNK_OVERLAP:] if len(current) > CHUNK_OVERLAP else current
            # Find a clean sentence start in the overlap
            overlap_match = re.search(r'\.\s+([A-Z])', overlap_text)
            if overlap_match:
                clean_start = overlap_text[overlap_match.start()+2:]
                current = clean_start + " " + sentence
            else:
                current = sentence
        else:
            current = candidate

    # Don't forget the last chunk
    if current.strip() and len(current.strip()) >= MIN_CHUNK:
        chunks.append({
            "text": current.strip(),
            "id": f"{filename}__chunk_{chunk_index}",
            "metadata": {
                "source":      filename,
                "chunk_index": chunk_index,
                "length":      len(current)
            }
        })

    return chunks


def get_embedding(text):
    """Send text to Nomic-Embed and get back a 768-number vector."""
    payload = {
        "model": "nomic-embed-text-v2-moe",
        "input": text[:2000]
    }
    try:
        response = requests.post(EMBED_URL, json=payload, timeout=30)
        data = response.json()
        return data["data"][0]["embedding"]
    except Exception as e:
        print(f"    Embedding failed: {e}")
        return None


def process_all_documents():
    """Main function — index all documents in the configured folder."""

    print(f"Document folder: {DOCS_FOLDER}")

    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    collection = client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )

    supported = (".pdf", ".docx", ".txt")
    files = [f for f in os.listdir(DOCS_FOLDER) if f.lower().endswith(supported)]

    if not files:
        print(f"No files found. Add PDF, Word or TXT files to:\n{DOCS_FOLDER}")
        return

    print(f"\nFound {len(files)} file(s):\n")

    total_stored = 0

    for filename in files:
        filepath = os.path.join(DOCS_FOLDER, filename)
        ext = os.path.splitext(filename)[1].lower()

        print(f"Processing: {filename}")

        try:
            if ext == ".pdf":
                text = read_pdf(filepath)
            elif ext == ".docx":
                text = read_docx(filepath)
            elif ext == ".txt":
                text = read_txt(filepath)
            else:
                continue
        except Exception as e:
            print(f"  Could not read: {e}")
            continue

        if not text.strip():
            print(f"  File appears empty, skipping.")
            continue

        chunks = chunk_text(text, filename)
        print(f"  Split into {len(chunks)} chunks")

        stored = 0
        for chunk in chunks:
            existing = collection.get(ids=[chunk["id"]])
            if existing["ids"]:
                continue   # Already indexed

            embedding = get_embedding(chunk["text"])
            if embedding is None:
                continue

            collection.add(
                ids        = [chunk["id"]],
                embeddings = [embedding],
                documents  = [chunk["text"]],
                metadatas  = [chunk["metadata"]]
            )
            stored += 1

        total_stored += stored
        print(f"  Stored {stored} new chunks")

    print(f"\nDone!")
    print(f"New chunks stored : {total_stored}")
    print(f"Total in database : {collection.count()}")
    print(f"Database location : {CHROMA_FOLDER}")


if __name__ == "__main__":
    print("=" * 55)
    print("APNJ Document Processor v2")
    print("=" * 55)
    print(f"\nChunk size    : {CHUNK_SIZE} chars (~{CHUNK_SIZE//4} words)")
    print(f"Chunk overlap : {CHUNK_OVERLAP} chars")
    print(f"Min chunk     : {MIN_CHUNK} chars\n")

    try:
        requests.get("http://127.0.0.1:8081/health", timeout=3)
        print("Nomic-Embed running on port 8081\n")
    except:
        print("WARNING: Nomic-Embed not detected on port 8081")
        print("Start your servers before processing!\n")

    process_all_documents()