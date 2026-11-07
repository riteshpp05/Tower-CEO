import requests, json

q = "What are the Finance targeted benefits for most likely scenario?"
r = requests.post(
    "http://127.0.0.1:3000/rag/excel",
    json={"question": q},
    timeout=60
)
print(json.dumps(r.json(), indent=2))