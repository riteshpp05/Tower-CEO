# ============================================================
# progress.py — APNJ Jarvis
# ============================================================
# Every processor (Excel, code, folder, documents) runs as its own
# standalone process — sometimes triggered manually, sometimes by
# jarvis_watcher.py running in a completely separate process from
# jarvis_server.py. None of them share memory, so there's no direct
# way for the UI (talking only to jarvis_server.py) to see what a
# processor running elsewhere is doing.
#
# This module is the bridge: a small shared JSON file that any
# processor writes progress into, and that jarvis_server.py's
# /progress endpoint reads and serves to the UI for polling.
#
# Writes are atomic (write to a temp file, then os.replace) so a
# poll never reads a half-written file mid-update — a real risk
# with plain overwrite, since a request could land in the exact
# instant between "truncate" and "write new content".
# ============================================================

import os
import json
import tempfile
from datetime import datetime, timezone

PROGRESS_FILE = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\jarvis_progress.json"


def _read_all():
    try:
        with open(PROGRESS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_all(data):
    d = os.path.dirname(PROGRESS_FILE)
    os.makedirs(d, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_path, PROGRESS_FILE)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def set_progress(task, current, total, current_file=None, status="running"):
    """Call this once per file as a processor works through its list —
    task is a short name ('excel', 'code', 'folder', 'doc')."""
    data = _read_all()
    data[task] = {
        "status": status, "current": current, "total": total,
        "current_file": current_file,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_all(data)


def finish_progress(task):
    """Call once at the end of a run — marks the task done rather than
    leaving it looking permanently 'in progress' at its last file."""
    data = _read_all()
    if task in data:
        data[task]["status"] = "done"
        data[task]["current_file"] = None
        data[task]["updated_at"] = datetime.now(timezone.utc).isoformat()
        _write_all(data)


def get_progress():
    """Everything currently known — read fresh from disk every call,
    since the writer is always a different process."""
    return _read_all()
