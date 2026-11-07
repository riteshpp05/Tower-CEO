"""
check_sales_chat_import.py — verifies cfo_tower.chat_sales imports cleanly
with .env loaded, same way cfo_server.py will load it in production.
Run from APNJ-LLM-Studio: python check_sales_chat_import.py
Delete this file once confirmed working.
"""
from dotenv import load_dotenv
load_dotenv("cfo_tower/.env")

from cfo_tower.chat_sales.chat_routes_sales import router

print("Sales chat module imported successfully.")
print(f"Routes registered: {[r.path for r in router.routes]}")
