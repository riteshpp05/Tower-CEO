import requests, json

questions = [
    "What is TDS rate for rent payment?",
    "What are Finance targeted benefits most likely scenario?",
    "What does SEBI regulate?",
    "Give me all TDS sections before and after new Income Tax Act"
]

for q in questions:
    r = requests.post(
        "http://127.0.0.1:3000/rag/unified",
        json={"question": q},
        timeout=60
    )
    d = r.json()
    print(f"\nQ: {q}")
    print(f"Has context: {d.get('has_context')}")
    print(f"Chunks used: {d.get('chunks_used', 0)}")
    if d.get('sources'):
        for s in d['sources'][:3]:
            print(f"  {s['type']:8} {s['relevance']}%  {s['file'][:40]}")
    if d.get('answer'):
        print(f"Answer: {d['answer'][:150]}...")