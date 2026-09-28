"""
migrate_to_rag_anything.py  —  APNJ LLM Studio
===============================================================
One-time migration: exports chunks from existing ChromaDB collections
and re-indexes them into RAGAnything workspaces.

Usage:
    cd "F:\Visual Code Directory\RAG-Anything"
    venv\Scripts\activate
    python "F:\Visual Code Directory\APNJ-LLM-Studio\rag\migrate_to_rag_anything.py"

Requirements: pip install chromadb raganything lightrag-hku
"""

import asyncio
import json
import os
import tempfile
from functools import partial
from pathlib import Path

import chromadb
from raganything import RAGAnything, RAGAnythingConfig
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc

# ── CONFIG ────────────────────────────────────────────────────
BASE_DIR       = r"F:\Visual Code Directory\APNJ-LLM-Studio"
CONFIG_FILE    = os.path.join(BASE_DIR, "data", "studio_config.json")
CHROMA_FOLDER  = os.path.join(BASE_DIR, "data", "chroma_db")
WORKSPACES_DIR = os.path.join(BASE_DIR, "data", "rag_anything_workspaces")
MINERU_OUTPUT  = os.path.join(BASE_DIR, "data", "mineru_output")

LLM_BASE_URL   = "http://localhost:8080/v1"
EMBED_BASE_URL = "http://localhost:8081/v1"
LLM_MODEL      = "gemma-4-E4B-it-Q4_K_M.gguf"
EMBED_MODEL    = "nomic-embed-text-v2-moe-q8_0.gguf"
EMBED_DIM      = 768

COLLECTION_MAP = {
    "apnj_documents": "apnj_documents",
    "apnj_excel":     "apnj_excel",
    "apnj_web":       "apnj_web",
}


def load_chroma_folder():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f).get("chroma_folder", CHROMA_FOLDER)
    except Exception:
        return CHROMA_FOLDER


def make_rag(workspace: str) -> RAGAnything:
    working_dir = os.path.join(WORKSPACES_DIR, workspace)
    os.makedirs(working_dir, exist_ok=True)

    async def llm_func(prompt, system_prompt=None, history_messages=[], **kwargs):
        kwargs.pop("model", None)
        return await openai_complete_if_cache(
            model=LLM_MODEL,
            prompt=prompt,
            system_prompt=system_prompt,
            history_messages=history_messages,
            base_url=LLM_BASE_URL,
            api_key="not-needed",
            **kwargs,
        )

    embed_func = EmbeddingFunc(
        embedding_dim=EMBED_DIM,
        max_token_size=512,
        func=partial(
            openai_embed,
            model=EMBED_MODEL,
            base_url=EMBED_BASE_URL,
            api_key="not-needed",
        ),
    )

    config = RAGAnythingConfig(working_dir=working_dir)
    return RAGAnything(config=config, llm_model_func=llm_func, embedding_func=embed_func)


async def migrate_collection(chroma_folder: str, collection_name: str, workspace: str):
    print(f"\n{'='*55}")
    print(f"Migrating '{collection_name}' -> workspace '{workspace}'")
    print(f"{'='*55}")

    # Clean any partial workspace from previous failed runs
    import shutil
    ws_dir = os.path.join(WORKSPACES_DIR, workspace)
    if os.path.isdir(ws_dir):
        shutil.rmtree(ws_dir)
        print(f"  Cleaned partial workspace")

    client = chromadb.PersistentClient(path=chroma_folder)
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"}
    )
    count = collection.count()
    print(f"  Found {count} chunks in ChromaDB")
    if count == 0:
        print("  Nothing to migrate — skipping.")
        return

    all_docs  = collection.get(include=["documents", "metadatas"], limit=count)
    documents = all_docs["documents"]
    metadatas = all_docs["metadatas"]

    # Group chunks back by source document
    source_map: dict[str, list[str]] = {}
    for doc, meta in zip(documents, metadatas):
        source = meta.get("source", meta.get("url", "unknown"))
        key    = Path(source).stem[:60] or "batch"
        source_map.setdefault(key, []).append(doc)

    print(f"  Grouped into {len(source_map)} source documents")

    rag = make_rag(workspace)
    out = os.path.join(MINERU_OUTPUT, workspace)
    os.makedirs(out, exist_ok=True)

    ok = fail = 0
    for src_name, chunks in source_map.items():
        combined = "\n\n---\n\n".join(chunks)
        with tempfile.NamedTemporaryFile(
            suffix=".txt", mode="w", encoding="utf-8", delete=False
        ) as f:
            f.write(combined)
            tmp = f.name
        try:
            await rag.process_document_complete(tmp, out)
            print(f"  OK  {src_name[:60]}")
            ok += 1
        except Exception as e:
            print(f"  FAIL  {src_name[:60]}: {e}")
            fail += 1
        finally:
            os.unlink(tmp)

    print(f"\n  Done: {ok} uploaded, {fail} failed")


async def main():
    chroma_folder = load_chroma_folder()
    print(f"\nChromaDB path : {chroma_folder}")
    print(f"Workspaces    : {WORKSPACES_DIR}")
    print(f"LLM           : {LLM_BASE_URL}  ({LLM_MODEL})")
    print(f"Embeddings    : {EMBED_BASE_URL}  ({EMBED_MODEL})")
    print(f"Embed dim     : {EMBED_DIM}")
    print(f"Max tokens    : 512\n")

    for chroma_name, workspace in COLLECTION_MAP.items():
        await migrate_collection(chroma_folder, chroma_name, workspace)

    print("\n" + "="*55)
    print("Migration complete!")
    print("Start rag_anything_server.py (Start-RAG-Bridge.bat) to use the new backend.")
    print("="*55)


if __name__ == "__main__":
    asyncio.run(main())