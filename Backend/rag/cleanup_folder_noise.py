# ============================================================
# cleanup_folder_noise.py — APNJ Jarvis (one-off)
# ============================================================
# Removes the mineru_output / rag_anything_workspaces entries that
# got written to jarvis_files before the exclusion was added. Safe
# to run once and delete afterward — cascades to their nodes/edges
# automatically via the foreign key ON DELETE CASCADE.
#
# Run:
#     python cleanup_folder_noise.py
# ============================================================

import provenance

PATTERNS = ["%mineru_output%", "%rag_anything_workspaces%"]

with provenance.get_connection() as conn:
    with conn.cursor() as cur:
        total = 0
        for pattern in PATTERNS:
            cur.execute("DELETE FROM jarvis_files WHERE file_path LIKE %s;", (pattern,))
            print(f"  {pattern}: removed {cur.rowcount} file(s) (and their nodes/edges via cascade)")
            total += cur.rowcount
    conn.commit()

print(f"\nDone! Removed {total} entries total.")
