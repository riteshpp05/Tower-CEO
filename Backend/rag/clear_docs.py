import chromadb

CHROMA_FOLDER = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\chroma_db"

client = chromadb.PersistentClient(path=CHROMA_FOLDER)
try:
    client.delete_collection('apnj_documents')
    print("Cleared apnj_documents collection!")
except Exception as e:
    print(f"Collection may not exist yet: {e}")

print(f"Remaining collections: {[c.name for c in client.list_collections()]}")