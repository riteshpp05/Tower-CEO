"""
check_env.py — quick sanity check that the CRM .env vars loaded correctly.
Run from APNJ-LLM-Studio: python check_env.py
Delete this file once confirmed working; it's just a one-time check.
"""
import os
from dotenv import load_dotenv

load_dotenv("cfo_tower/.env")

vars_to_check = [
    "ZOHO_CRM_CLIENT_ID",
    "ZOHO_CRM_CLIENT_SECRET",
    "ZOHO_CRM_REFRESH_TOKEN",
    "ZOHO_CRM_API_BASE",
]

all_ok = True
for var in vars_to_check:
    value = os.environ.get(var)
    if value:
        # Show just enough to confirm it's the right value, without printing the whole secret
        preview = value[:6] + "..." if len(value) > 6 else value
        print(f"OK   {var} = {preview}")
    else:
        print(f"MISSING   {var}")
        all_ok = False

print()
print("All good — ready for the SQL migration." if all_ok else "Fix the MISSING vars in cfo_tower/.env before continuing.")
