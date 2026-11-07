# ============================================================
# bootstrap_jarvis_db.py — APNJ Jarvis
# ============================================================
# Creates the local 'jarvis' Postgres database (if it doesn't already
# exist) and loads db_schema.sql — without needing psql or createdb
# on your PATH. Everything goes through psycopg2, same as the rest
# of Jarvis.
#
# Prerequisite: jarvis_db.env must exist with credentials for a
# Postgres user that can create databases (the 'postgres' superuser
# is fine for a local instance). See SETUP_JARVIS.md.
#
# Run:
#     python bootstrap_jarvis_db.py
# ============================================================

import psycopg2
import provenance as prov


def create_database_if_missing():
    """
    Connects to the default 'postgres' database (which always exists)
    to check for / create the 'jarvis' database — you can't create a
    database while connected to itself, hence connecting to 'postgres'
    first. autocommit is required because CREATE DATABASE can't run
    inside a transaction block.
    """
    conn = psycopg2.connect(
        host=prov.PG_HOST, port=prov.PG_PORT, dbname="postgres",
        user=prov.PG_USER, password=prov.PG_PASS,
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (prov.PG_DB,))
            if cur.fetchone():
                print(f"Database '{prov.PG_DB}' already exists — skipping creation.")
            else:
                cur.execute(f'CREATE DATABASE "{prov.PG_DB}"')
                print(f"Created database '{prov.PG_DB}'.")
    finally:
        conn.close()


if __name__ == "__main__":
    create_database_if_missing()
    prov.ensure_schema()
    print(f"\nJarvis schema ready on {prov.PG_HOST}:{prov.PG_PORT}/{prov.PG_DB}")
    print("You can now run: python excel_graph_processor.py")
