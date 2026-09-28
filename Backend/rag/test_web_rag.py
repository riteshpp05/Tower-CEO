import requests, json

# Test 1 — broader question
q = "What is income tax in India and how does it work?"
r = requests.post(
    "http://127.0.0.1:3000/rag/web",
    json={"question": q},
    timeout=60
)
d = r.json()
print("ANSWER:", d.get("answer",""))
print("\nSOURCES:")
for s in d.get("sources", []):
    print(f"  {s['file']} | Section {s['section']} | {s['relevance']}%")