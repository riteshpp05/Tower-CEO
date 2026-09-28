# ============================================================
# excel_processor.py  —  APNJ LLM Studio
# Reads ALL Excel/CSV files from data\uploaded_excels\
# Indexes every sheet of every file into apnj_excel collection
# Run this once to index existing files.
# For automatic indexing of new files use auto_indexer.py
# ============================================================

import os
import json
import requests
import chromadb
import pandas as pd

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

EXCEL_FOLDER  = cfg.get("excel_folder",
    os.path.join(BASE_DIR, "data", "uploaded_excels"))
CHROMA_FOLDER = cfg.get("chroma_folder",
    os.path.join(BASE_DIR, "data", "chroma_db"))

EMBED_URL   = "http://127.0.0.1:8081/v1/embeddings"
COLLECTION  = "apnj_excel"
SUPPORTED   = (".xlsx", ".xlsm", ".csv")
SKIP_SHEETS = ["Main Menu", "Benefit Projections"]
SKIP_LABELS = {
    "main menu","data inputs:","benefit opportunities:",
    "targeted benefits","nan","none",""
}


def get_embedding(text):
    try:
        r = requests.post(
            EMBED_URL,
            json={"model":"nomic-embed-text-v2-moe","input":text[:2000]},
            timeout=30
        )
        return r.json()["data"][0]["embedding"]
    except Exception as e:
        print(f"    Embedding failed: {e}")
        return None


def clean_val(v):
    if pd.isna(v): return ""
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else f"{v:.4f}"
    return str(v).strip()


def extract_chunks(df, sheet_name, filename):
    """Convert each meaningful row into a searchable chunk."""
    chunks = []
    for row_idx, row in df.iterrows():
        label = clean_val(row.iloc[0]) if len(row) > 0 else ""
        if not label or label.lower() in SKIP_LABELS:
            continue
        if len(label) < 8 or label.startswith("     "):
            continue

        def gc(i):
            v = clean_val(row.iloc[i]) if i < len(row) else ""
            return "" if v.lower() in ["nan","none"] else v

        parts = [
            f"File: {filename}",
            f"Sheet: {sheet_name}",
            f"Item: {label}"
        ]
        for i, lbl in [
            (1,"Units"), (2,"Cost"), (3,"Total"),
            (5,"Conservative"), (6,"Most Likely"), (7,"Aggressive")
        ]:
            v = gc(i)
            if v and v not in ["0","0.00"]:
                parts.append(f"{lbl}: {v}")

        # Scan for large numeric values (benefit amounts)
        benefit_vals = []
        for ci in range(8, min(len(row), 30)):
            v = gc(ci)
            if v:
                try:
                    num = float(v.replace(",",""))
                    if abs(num) > 100:
                        benefit_vals.append(f"${int(num):,}")
                except: pass
        if benefit_vals:
            parts.append(f"Values: {' | '.join(benefit_vals[:3])}")

        if len(parts) >= 3:
            chunks.append({
                "text": " | ".join(parts),
                "id":   f"{filename}__{sheet_name}__row_{row_idx}",
                "metadata": {
                    "source": filename,
                    "sheet":  sheet_name,
                    "row":    row_idx,
                    "label":  label[:100]
                }
            })
    return chunks


def process_file(filepath, filename, collection):
    """Index one Excel/CSV file."""
    ext = os.path.splitext(filename)[1].lower()
    print(f"\n  Processing: {filename}")
    all_chunks = []

    try:
        if ext == ".csv":
            df = pd.read_csv(filepath, dtype=str, keep_default_na=True)
            chunks = extract_chunks(df, "CSV", filename)
            all_chunks.extend(chunks)
            print(f"    CSV: {len(chunks)} chunks")
        else:
            xl = pd.ExcelFile(filepath)
            for sheet in xl.sheet_names:
                if sheet in SKIP_SHEETS:
                    print(f"    Skipping sheet: {sheet}")
                    continue
                try:
                    df = pd.read_excel(xl, sheet_name=sheet,
                                       header=None, dtype=str)
                    chunks = extract_chunks(df, sheet, filename)
                    all_chunks.extend(chunks)
                    print(f"    {sheet}: {len(chunks)} chunks")
                except Exception as e:
                    print(f"    Sheet '{sheet}' error: {e}")
    except Exception as e:
        print(f"    Failed to open: {e}")
        return 0

    stored = 0
    for chunk in all_chunks:
        if collection.get(ids=[chunk["id"]])["ids"]:
            continue
        emb = get_embedding(chunk["text"])
        if emb is None:
            continue
        collection.add(
            ids=[chunk["id"]],
            embeddings=[emb],
            documents=[chunk["text"]],
            metadatas=[chunk["metadata"]]
        )
        stored += 1

    print(f"    Stored {stored} new chunks")
    return stored


def process_all():
    """Index ALL Excel/CSV files in the excel_folder."""
    print(f"Excel folder : {EXCEL_FOLDER}")

    if not os.path.exists(EXCEL_FOLDER):
        print(f"Creating folder: {EXCEL_FOLDER}")
        os.makedirs(EXCEL_FOLDER, exist_ok=True)
        print("Folder created. Add Excel files and run again.")
        return

    files = [
        f for f in os.listdir(EXCEL_FOLDER)
        if f.lower().endswith(SUPPORTED) and not f.startswith("~")
    ]

    if not files:
        print(f"No Excel/CSV files found in:\n{EXCEL_FOLDER}")
        print("Add .xlsx .xlsm or .csv files and run again.")
        return

    print(f"Found {len(files)} file(s):")
    for f in files:
        print(f"  {f}")

    client     = chromadb.PersistentClient(path=CHROMA_FOLDER)
    collection = client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space":"cosine"}
    )

    total = 0
    for filename in files:
        filepath = os.path.join(EXCEL_FOLDER, filename)
        total   += process_file(filepath, filename, collection)

    print(f"\nDone!")
    print(f"New chunks stored : {total}")
    print(f"Total in database : {collection.count()}")


if __name__ == "__main__":
    print("=" * 55)
    print("APNJ Excel Processor")
    print("=" * 55)
    print(f"\nIndexes ALL files in the excel_folder.")
    print(f"Drop new Excel files in uploaded_excels\ anytime.\n")

    try:
        requests.get("http://127.0.0.1:8081/health", timeout=3)
        print("Nomic-Embed running\n")
    except:
        print("WARNING: Nomic-Embed not detected on port 8081\n")

    process_all()
