# ============================================================
# spot_check_code.py — APNJ Jarvis
# ============================================================
# Same idea as spot_check.py, for the code graph. Prints real
# import and call edges for a chosen file, so you can eyeball
# whether the resolution actually matches what you know the code
# does.
#
# Run:
#     python spot_check_code.py
# ============================================================

import provenance

# Edit this to inspect a different file — match on a path fragment.
FILE_MATCH = "chat_routes.py"


def get_file_id(name_match):
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, file_path FROM jarvis_files WHERE file_path LIKE %s;", (f"%{name_match}",))
            return cur.fetchall()


def print_edges_for_file(file_id, file_path):
    print(f"\n=== {file_path} (id={file_id}) ===")
    with provenance.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sn.identifier, e.edge_type, e.confidence, tn.identifier, tf.file_path
                FROM jarvis_edges e
                JOIN jarvis_nodes sn ON sn.id = e.source_node_id
                JOIN jarvis_nodes tn ON tn.id = e.target_node_id
                JOIN jarvis_files tf ON tf.id = tn.file_id
                WHERE sn.file_id = %s
                ORDER BY e.edge_type, sn.identifier;
            """, (file_id,))
            rows = cur.fetchall()

    if not rows:
        print("  No edges found for this file.")
        return

    for source_id, edge_type, confidence, target_id, target_file in rows:
        same_file = " (same file)" if target_file == file_path else f"  -> {target_file}"
        print(f"  [{edge_type}, conf={confidence}]  {source_id}  ==>  {target_id}{same_file}")


if __name__ == "__main__":
    matches = get_file_id(FILE_MATCH)
    if not matches:
        print(f"No file matching '{FILE_MATCH}' found.")
    else:
        for file_id, file_path in matches:
            print_edges_for_file(file_id, file_path)
