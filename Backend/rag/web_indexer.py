# ============================================================
# web_indexer.py
# WHAT THIS DOES:
# Reads all .txt files saved by web_crawler.py
# Chops each file into overlapping chunks
# Sends each chunk to Nomic-Embed for embedding
# Stores everything in ChromaDB as "apnj_web" collection
#
# This is almost identical to doc_processor.py but:
# - Reads from crawled_pages/ folder
# - Uses "apnj_web" collection (separate from documents)
# - Preserves the source URL in metadata
# ============================================================

import os
import requests
import chromadb

# ── SETTINGS ────────────────────────────────────────────────
CRAWLED_FOLDER = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\crawled_pages"
CHROMA_FOLDER  = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\chroma_db"
EMBED_URL      = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION     = "apnj_web"

# Chunk settings — larger than docs because web pages are prose
CHUNK_SIZE    = 1500
CHUNK_OVERLAP = 300


def get_embedding(text):
    """Send text to Nomic-Embed and get back 768 numbers."""
    payload = {
        "model": "nomic-embed-text-v2-moe",
        "input": text[:2000]
    }
    try:
        response = requests.post(EMBED_URL, json=payload, timeout=30)
        data = response.json()
        return data["data"][0]["embedding"]
    except Exception as e:
        print(f"    ⚠ Embedding failed: {e}")
        return None


def extract_metadata(text):
    """
    Pull SOURCE URL and TITLE from the top of a crawled file.
    Our crawler saved them as:
        SOURCE URL: https://...
        TITLE: Page Title
    """
    source_url = ""
    title = ""
    for line in text.splitlines()[:6]:
        if line.startswith("SOURCE URL:"):
            source_url = line.replace("SOURCE URL:", "").strip()
        if line.startswith("TITLE:"):
            title = line.replace("TITLE:", "").strip()
    return source_url, title


def chunk_text(text, filename, source_url, title):
    """
    Chop text into overlapping chunks.
    Skip the metadata header at the top (first 6 lines).
    """
    # Skip header lines
    lines = text.splitlines()
    content_start = 0
    for i, line in enumerate(lines):
        if "=" * 20 in line:
            content_start = i + 1
            break

    content = "\n".join(lines[content_start:])

    chunks = []
    start = 0
    chunk_index = 0

    while start < len(content):
        end = start + CHUNK_SIZE
        chunk = content[start:end].strip()

        if chunk and len(chunk) > 100:  # Skip tiny chunks
            chunks.append({
                "text": chunk,
                "id":   f"{filename}__chunk_{chunk_index}",
                "metadata": {
                    "source":      filename,
                    "url":         source_url,
                    "title":       title[:100],
                    "chunk_index": chunk_index
                }
            })
            chunk_index += 1

        start += CHUNK_SIZE - CHUNK_OVERLAP

    return chunks


def process_all_pages():
    """Main function — index all crawled pages."""

    # Connect to ChromaDB
    client = chromadb.PersistentClient(path=CHROMA_FOLDER)
    collection = client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )

    # Find all .txt files (skip crawl_list.txt)
    files = [
        f for f in os.listdir(CRAWLED_FOLDER)
        if f.endswith(".txt") and f != "crawl_list.txt"
    ]

    if not files:
        print("No crawled pages found.")
        print(f"Run web_crawler.py first to save pages to:\n{CRAWLED_FOLDER}")
        return

    print(f"Found {len(files)} crawled page(s) to index:\n")

    for filename in files:
        filepath = os.path.join(CRAWLED_FOLDER, filename)

        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()

        source_url, title = extract_metadata(text)

        print(f"🌐 Indexing: {title or filename}")
        print(f"   URL: {source_url or 'unknown'}")

        chunks = chunk_text(text, filename, source_url, title)
        print(f"   ✂ {len(chunks)} chunks")

        stored = 0
        for chunk in chunks:
            existing = collection.get(ids=[chunk["id"]])
            if existing["ids"]:
                continue

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

        print(f"   ✅ Stored {stored} new chunks\n")

    total = collection.count()
    print(f"🎉 Done! Total web chunks in DB: {total}")


if __name__ == "__main__":
    print("=" * 55)
    print("APNJ Web Page Indexer")
    print("=" * 55)
    print(f"\nReading from : {CRAWLED_FOLDER}")
    print(f"ChromaDB     : {CHROMA_FOLDER}\n")

    try:
        requests.get("http://127.0.0.1:8081/health", timeout=3)
        print("✅ Nomic-Embed running\n")
    except:
        print("⚠ WARNING: Nomic-Embed not detected on port 8081")
        print("  Start your servers first!\n")

    process_all_pages()