"""
diagnose_crm_oauth.py — bypasses zoho_crm_auth.py entirely and shows you
EXACTLY what's being sent, including invisible characters (trailing
spaces, stray \\r from Windows line endings, etc.) that a normal print()
would hide.

Run from APNJ-LLM-Studio: python diagnose_crm_oauth.py
Delete this file once the real problem is found.
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv("cfo_tower/.env")

vars_needed = [
    "ZOHO_CRM_CLIENT_ID",
    "ZOHO_CRM_CLIENT_SECRET",
    "ZOHO_CRM_REFRESH_TOKEN",
    "ZOHO_ACCOUNTS_URL",
]

print("=" * 70)
print("RAW VALUES (repr() shows hidden whitespace/newlines as \\r \\n etc.)")
print("=" * 70)
for var in vars_needed:
    value = os.environ.get(var)
    if value is None:
        print(f"{var}: NOT SET AT ALL")
    else:
        print(f"{var}:")
        print(f"  repr:   {value!r}")
        print(f"  length: {len(value)}")
        print(f"  stripped == original: {value.strip() == value}")
print()

client_id = os.environ.get("ZOHO_CRM_CLIENT_ID", "").strip()
client_secret = os.environ.get("ZOHO_CRM_CLIENT_SECRET", "").strip()
refresh_token = os.environ.get("ZOHO_CRM_REFRESH_TOKEN", "").strip()
accounts_url = os.environ.get("ZOHO_ACCOUNTS_URL", "").strip()

print("=" * 70)
print(f"Making raw request to: {accounts_url}/oauth/v2/token")
print("=" * 70)

url = f"{accounts_url}/oauth/v2/token"
params = {
    "grant_type": "refresh_token",
    "client_id": client_id,
    "client_secret": client_secret,
    "refresh_token": refresh_token,
}

resp = requests.post(url, params=params, timeout=15)
print(f"HTTP status: {resp.status_code}")
print(f"Full response body: {resp.text}")
print()

if resp.status_code == 200 and "access_token" in resp.json():
    print("SUCCESS — the values in .env are actually fine!")
    print("If the real sync still failed before, something else is going on")
    print("(e.g. .env not being loaded from the right path) — tell me the")
    print("full output above and we'll dig further.")
else:
    print("This confirms the failure is in the credentials/token themselves,")
    print("not in how the Python code constructs the request.")
    print("Paste this ENTIRE output back — especially the repr() lines and")
    print("the full response body — and we'll pin down the exact cause.")
