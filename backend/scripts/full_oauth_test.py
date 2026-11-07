"""
full_oauth_test.py — the definitive test. Does the grant-token exchange
AND an immediate refresh-token test in the same script run, back to back,
with zero manual copy-paste step in between. This eliminates every
variable we've been chasing so far (file save timing, clipboard
corruption, .env caching) in one shot.

Run: python full_oauth_test.py
It will prompt you to paste a FRESH grant token (generate one right
before running this).
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv("cfo_tower/.env")

client_id = os.environ["ZOHO_CRM_CLIENT_ID"].strip()
client_secret = os.environ["ZOHO_CRM_CLIENT_SECRET"].strip()
accounts_url = os.environ["ZOHO_ACCOUNTS_URL"].strip()

grant_token = input("Paste a FRESH grant token (generate it right before running this): ").strip()

url = f"{accounts_url}/oauth/v2/token"

print("\n" + "=" * 70)
print("STEP 1: Exchanging grant token for access_token + refresh_token")
print("=" * 70)

step1_params = {
    "grant_type": "authorization_code",
    "client_id": client_id,
    "client_secret": client_secret,
    "code": grant_token,
}
# IMPORTANT: sent as body (data=), not query string (params=). Zoho's
# authorization_code exchange appears to require form-encoded BODY data --
# this matches how oauth_crm_token_exchange.ps1's Invoke-WebRequest -Body
# actually sends it (PowerShell defaults hashtable -Body to
# application/x-www-form-urlencoded in the request body on POST).
# This is very likely the real root cause of every invalid_code error
# we've seen from Python-based exchange attempts.
resp1 = requests.post(url, data=step1_params, timeout=15)
print(f"HTTP status: {resp1.status_code}")
print(f"Response: {resp1.text}")
data1 = resp1.json()

if "refresh_token" not in data1:
    print("\nSTEP 1 FAILED — no refresh_token in response. Stopping here.")
    print("This means the grant token itself was rejected immediately,")
    print("with zero delay between generating it and using it.")
    raise SystemExit(1)

new_refresh_token = data1["refresh_token"]
print(f"\nGot refresh_token: {new_refresh_token[:15]}... (length {len(new_refresh_token)})")

print("\n" + "=" * 70)
print("STEP 2: Immediately using that refresh_token (zero delay)")
print("=" * 70)

step2_params = {
    "grant_type": "refresh_token",
    "client_id": client_id,
    "client_secret": client_secret,
    "refresh_token": new_refresh_token,
}
resp2 = requests.post(url, params=step2_params, timeout=15)
print(f"HTTP status: {resp2.status_code}")
print(f"Response: {resp2.text}")

print("\n" + "=" * 70)
if "access_token" in resp2.json():
    print("BOTH STEPS SUCCEEDED. The refresh token is genuinely valid.")
    print(f"\nSave this to .env as ZOHO_CRM_REFRESH_TOKEN:")
    print(new_refresh_token)
else:
    print("STEP 2 FAILED even with zero delay after a successful STEP 1.")
    print("This is a real, reproducible anomaly — paste this entire output")
    print("back for further diagnosis, this rules out every timing/caching")
    print("explanation we've tried so far.")