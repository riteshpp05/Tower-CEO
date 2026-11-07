# ============================================================
# jarvis_watcher.py — APNJ Jarvis
# ============================================================
# Watches every configured Jarvis folder (excel_folder, code_folders,
# watched_folders) recursively and keeps the graph in sync — this is
# the upgrade over auto_indexer.py's original watcher: recursive
# (subfolders included), debounced (rapid saves collapse into one
# rerun), and with a real retry mechanism for embeddings that failed
# because the embedding server was down (the exact gap we hit
# manually with --force during Excel/code testing).
#
# HOW DISPATCH WORKS:
#   Excel/code resolution both rely on hash-based skip-unchanged logic
#   in their own processors, so on any relevant file change this
#   watcher just re-invokes that processor's full (non-force) entry
#   point — unchanged files skip fast, only the real change does work.
#   Code calls are cross-file by design (see code_graph_processor's
#   two-pass resolution), so there's no cheaper "just this one file"
#   option there without breaking resolution correctness.
#
# HOW THE PENDING QUEUE WORKS:
#   Excel/code processors mark a file's Postgres status as 'pending'
#   if any embedding call failed mid-run (server down, timeout, etc.)
#   — the graph/nodes are still correct, only embeddings are missing.
#   Every PENDING_RETRY_INTERVAL seconds, this watcher checks the
#   embedding server and, if reachable, retries exactly those files
#   with --force — not a full reprocess of everything, just the gap.
#
# HOW DELETIONS WORK:
#   Soft-delete via provenance.mark_file_missing — matches the
#   scoping discussion: a temporarily unmounted drive or a git
#   operation touching many files shouldn't wipe the index.
# ============================================================

import os
import time
import threading
import requests

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

import provenance
import excel_graph_processor as excel_proc
import code_graph_processor as code_proc
import folder_graph_processor as folder_proc
import doc_graph_processor as doc_proc

EXCLUDE_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", "site-packages", "chroma_db",
    "mineru_output", "rag_anything_workspaces",
}

EXCEL_EXTS = {".xlsx", ".xlsm"}
CODE_EXTS = {".py", ".js", ".jsx", ".ts", ".tsx"}
DOC_EXTS = {".pdf", ".docx"}

DEBOUNCE_SECONDS = 3.0
PENDING_RETRY_INTERVAL = 300  # 5 minutes
EMBED_HEALTH_URL = "http://127.0.0.1:8081/health"


def is_excluded(path):
    parts = os.path.normpath(path).split(os.sep)
    return any(p in EXCLUDE_DIRS or p.startswith(".") for p in parts)


def embed_server_up():
    try:
        requests.get(EMBED_HEALTH_URL, timeout=3)
        return True
    except Exception:
        return False


class DebouncedDispatcher:
    """
    Coalesces rapid file events into a single processor rerun per
    'kind' after a quiet period — ten saves in two seconds should
    trigger one rerun each for 'code'/'excel'/'folder', not ten.
    """
    def __init__(self):
        self._pending = set()
        self._lock = threading.Lock()
        self._timer = None

    def schedule(self, kind):
        with self._lock:
            self._pending.add(kind)
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(DEBOUNCE_SECONDS, self._flush)
            self._timer.daemon = True
            self._timer.start()

    def _flush(self):
        with self._lock:
            kinds, self._pending = self._pending, set()
        for kind in kinds:
            self._run(kind)

    def _run(self, kind):
        try:
            if kind == "code":
                print("\n[watcher] Code changed — rerunning code_graph_processor...")
                code_proc.process_all_code_files(force=False)
            elif kind == "excel":
                print("\n[watcher] Excel changed — rerunning excel_graph_processor...")
                excel_proc.process_all_excel_files(force=False)
            elif kind == "folder":
                print("\n[watcher] Folder structure changed — rerunning folder_graph_processor...")
                folder_proc.process_all_watched_folders()
            elif kind == "doc":
                print("\n[watcher] PDF/Word document changed — rerunning doc_graph_processor...")
                doc_proc.process_all_doc_files(force=False)
        except Exception as e:
            print(f"[watcher] Error while processing '{kind}': {e}")


class JarvisEventHandler(FileSystemEventHandler):
    def __init__(self, dispatcher):
        self.dispatcher = dispatcher

    def on_created(self, event):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._handle(event.dest_path)
            self._handle_delete(event.src_path)

    def on_deleted(self, event):
        if not event.is_directory:
            self._handle_delete(event.src_path)

    def _handle(self, path):
        if is_excluded(path):
            return
        # Office lock files (~$Book1.xlsx) appear/disappear on every
        # open/close — real content changes always also touch the
        # actual file, so these are pure noise to react to.
        if os.path.basename(path).startswith("~$"):
            return

        ext = os.path.splitext(path)[1].lower()
        if ext in EXCEL_EXTS:
            self.dispatcher.schedule("excel")
            self.dispatcher.schedule("folder")
        elif ext in CODE_EXTS:
            self.dispatcher.schedule("code")
            self.dispatcher.schedule("folder")
        elif ext in DOC_EXTS:
            self.dispatcher.schedule("doc")
            self.dispatcher.schedule("folder")
        else:
            self.dispatcher.schedule("folder")

    def _handle_delete(self, path):
        if is_excluded(path):
            return
        provenance.mark_file_missing(path)
        self.dispatcher.schedule("folder")


def retry_pending_files():
    pending = provenance.get_pending_files()
    if not pending:
        return
    if not embed_server_up():
        print(f"[watcher] {len(pending)} file(s) pending, but embedding server unreachable — will retry next cycle.")
        return

    excel_pending = [p for p in pending if p[2] == "excel"]
    code_pending = [p for p in pending if p[2] == "code"]

    if excel_pending:
        print(f"\n[watcher] Retrying {len(excel_pending)} Excel file(s) with incomplete embeddings...")
        collection = excel_proc.get_collection()
        for _file_id, filepath, _ftype in excel_pending:
            excel_proc.process_file(filepath, os.path.basename(filepath), collection, force=True)

    if code_pending:
        # Code resolution is cross-file by design — there's no cheaper
        # "just this file" retry without risking incorrect call/import
        # resolution, so a full (forced) rerun is the correct choice
        # here. This only happens when something is actually pending,
        # not on every cycle.
        print(f"\n[watcher] {len(code_pending)} code file(s) pending — rerunning code_graph_processor fully...")
        code_proc.process_all_code_files(force=True)


def pending_retry_loop():
    while True:
        time.sleep(PENDING_RETRY_INTERVAL)
        try:
            retry_pending_files()
        except Exception as e:
            print(f"[watcher] Error during pending retry: {e}")


def collect_watch_roots():
    roots = set()
    for f in excel_proc.WATCHED_FOLDERS:
        roots.add(f)
    for f in code_proc.CODE_FOLDERS:
        roots.add(f)
    for f in folder_proc.WATCHED_FOLDERS:
        roots.add(f)
    return sorted(r for r in roots if os.path.isdir(r))


def main():
    print("=" * 55)
    print("APNJ Jarvis Watcher")
    print("=" * 55)

    provenance.ensure_schema()

    roots = collect_watch_roots()
    if not roots:
        print("No folders configured (excel_folder / code_folders / watched_folders) — nothing to watch.")
        return

    print(f"\nWatching {len(roots)} root(s) recursively:")
    for r in roots:
        print(f"  {r}")

    if embed_server_up():
        print("\nEmbedding server reachable on port 8081.")
    else:
        print("\nWARNING: embedding server not reachable — new content will index into the")
        print("graph correctly but embeddings will be marked 'pending' and retried automatically")
        print(f"every {PENDING_RETRY_INTERVAL // 60} minutes once the server comes up.")

    print("\nRunning initial pass (skips anything already up to date)...")
    excel_proc.process_all_excel_files(force=False)
    code_proc.process_all_code_files(force=False)
    folder_proc.process_all_watched_folders()
    doc_proc.process_all_doc_files(force=False)

    dispatcher = DebouncedDispatcher()
    observer = Observer()
    for root in roots:
        observer.schedule(JarvisEventHandler(dispatcher), root, recursive=True)

    retry_thread = threading.Thread(target=pending_retry_loop, daemon=True)
    retry_thread.start()

    observer.start()
    print(f"\n{'='*55}")
    print("Watching for changes. Ctrl+C to stop.")
    print(f"{'='*55}\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        print("\nJarvis watcher stopped.")
    observer.join()


if __name__ == "__main__":
    main()