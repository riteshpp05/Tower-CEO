"""
cfo_server.py — minimal FastAPI service exposing sync triggers to
the frontend. First piece of a real backend service for CFO Tower.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.cfo_server

Runs on port 3002, bound to 0.0.0.0 — reachable from other devices
on the same network, not just this machine. To find this machine's
LAN IP (so other devices know where to connect):

    PowerShell: ipconfig
    Look for "IPv4 Address" under your active adapter
    (usually starts with 192.168.x.x or 10.x.x.x)

The frontend calls POST http://<this-machine-ip>:3002/sync/trigger
to run a full sync on demand.
"""

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

import threading
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from cfo_tower.chat.chat_routes import router as chat_router
from cfo_tower.chat_sales.chat_routes_sales import router as chat_sales_router
from .integrations.sync_all import run_all_syncs

app = FastAPI(title="CFO Tower Backend")
app.include_router(chat_router)
app.include_router(chat_sales_router)
# but FastAPI/browsers reject credentials with wildcard origins, and
# being explicit here costs nothing since this is an internal tool.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):5173",
    allow_methods=["*"],
    allow_headers=["*"],
)

_sync_state = {"running": False, "last_started": None, "last_result": None}


def _run_sync_background():
    _sync_state["running"] = True
    _sync_state["last_started"] = datetime.now(timezone.utc).isoformat()
    try:
        result = run_all_syncs()
        _sync_state["last_result"] = result
    finally:
        _sync_state["running"] = False


@app.post("/sync/trigger")
def trigger_sync():
    """Starts a full sync in the background. Returns immediately —
    the frontend should poll /sync/status to see progress."""
    if _sync_state["running"]:
        return {"status": "already_running", "started_at": _sync_state["last_started"]}

    thread = threading.Thread(target=_run_sync_background, daemon=True)
    thread.start()
    return {"status": "started"}


@app.get("/sync/status")
def sync_status():
    """Frontend polls this to know when a triggered sync finishes."""
    return _sync_state


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    # 0.0.0.0 = listen on every network interface, not just localhost.
    # This is what makes the server reachable from other devices on
    # the same network. Safe for a home/office LAN; do NOT expose this
    # port directly to the public internet without authentication.
    uvicorn.run(app, host="0.0.0.0", port=3002)
