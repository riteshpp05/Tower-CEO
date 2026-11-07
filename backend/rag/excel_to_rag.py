"""
excel_to_rag.py  —  APNJ LLM Studio
===============================================================
Converts Excel files → Markdown .txt files → RAGAnything apnj_excel workspace.

RAGAnything parses .txt / .md natively via MinerU.
Run this once for existing files, re-run whenever new Excel files are added.

Usage:
    cd "F:\Visual Code Directory\RAG-Anything"
    venv\Scripts\activate
    pip install pandas openpyxl tabulate
    python "F:\Visual Code Directory\APNJ-LLM-Studio\rag\excel_to_rag.py"
"""

import asyncio
import os
import tempfile
from functools import partial
from pathlib import Path

import pandas as pd
from raganything import RAGAnything, RAGAnythingConfig
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc

# ── CONFIG ────────────────────────────────────────────────────
BASE_DIR       = r"F:\Visual Code Directory\APNJ-LLM-Studio"
EXCEL_FOLDER   = os.path.join(BASE_DIR, "data", "uploaded_excels")
WORKSPACES_DIR = os.path.join(BASE_DIR, "data", "rag_anything_workspaces")
MINERU_OUTPUT  = os.path.join(BASE_DIR, "data", "mineru_output", "apnj_excel")
WORKSPACE      = "apnj_excel"

LLM_BASE_URL   = "http://127.0.0.1:8080/v1"
EMBED_BASE_URL = "http://127.0.0.1:8081/v1"
LLM_MODEL      = "gemma"
EMBED_MODEL    = "nomic-embed-text-v2-moe"
EMBED_DIM      = 768


def excel_to_markdown(filepath: str) -> str:
    """Convert an Excel/CSV file to a Markdown string (one section per sheet)."""
    lines = [f"# {Path(filepath).name}\n"]
    ext   = Path(filepath).suffix.lower()

    if ext in (".xlsx", ".xlsm"):
        xl = pd.ExcelFile(filepath, engine="openpyxl")
        for sheet in xl.sheet_names:
            try:
                df = xl.parse(sheet, nrows=200).fillna("").astype(str)
                if df.empty:
                    continue
                lines.append(f"\n## Sheet: {sheet}\n")
                lines.append(df.to_markdown(index=False))
                lines.append("")
            except Exception as e:
                lines.append(f"\n## Sheet: {sheet}\n[Parse error: {e}]\n")
    elif ext == ".csv":
        df = pd.read_csv(filepath, nrows=200).fillna("").astype(str)
        lines.append(f"\n## {Path(filepath).name}\n")
        lines.append(df.to_markdown(index=False))

    return "\n".join(lines)


async def main():
    files = [
        f for f in os.listdir(EXCEL_FOLDER)
        if f.lower().endswith((".xlsx", ".xlsm", ".csv"))
    ]
    if not files:
        print("No Excel/CSV files found in", EXCEL_FOLDER)
        return

    print(f"Found {len(files)} file(s) to index\n")

    working_dir = os.path.join(WORKSPACES_DIR, WORKSPACE)
    os.makedirs(working_dir, exist_ok=True)
    os.makedirs(MINERU_OUTPUT, exist_ok=True)

    llm_func = partial(
        openai_complete_if_cache,
        model=LLM_MODEL, base_url=LLM_BASE_URL, api_key="not-needed",
    )
    embed_func = EmbeddingFunc(
        embedding_dim=EMBED_DIM, max_token_size=8192,
        func=partial(openai_embed, model=EMBED_MODEL, base_url=EMBED_BASE_URL, api_key="not-needed"),
    )
    rag = RAGAnything(
        config=RAGAnythingConfig(working_dir=working_dir),
        llm_model_func=llm_func,
        embedding_func=embed_func,
    )

    for fname in files:
        fpath = os.path.join(EXCEL_FOLDER, fname)
        print(f"  Processing: {fname}")
        try:
            md_text = excel_to_markdown(fpath)
        except Exception as e:
            print(f"    ❌ Convert failed: {e}")
            continue

        with tempfile.NamedTemporaryFile(
            suffix=".md", mode="w", encoding="utf-8", delete=False
        ) as f:
            f.write(md_text)
            tmp = f.name

        try:
            await rag.process_document_complete(tmp, MINERU_OUTPUT)
            print(f"    ✅ Indexed ({len(md_text)} chars)")
        except Exception as e:
            print(f"    ❌ Index failed: {e}")
        finally:
            os.unlink(tmp)

    print("\nDone — Excel files indexed into workspace:", WORKSPACE)


if __name__ == "__main__":
    asyncio.run(main())
