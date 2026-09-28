"""
cfo_tower/chat/supabase_client.py

Minimal Supabase REST helpers for the chat backend. Uses the service role
key (server-side only, never shipped to the frontend) so the backend can
read any table/RPC needed to answer questions, regardless of the calling
user's RLS visibility on the underlying business tables (chat_sessions/
chat_messages themselves are still written via the normal RLS-respecting
flow -- see chat_service.py).

IMPORTANT: because this uses the service role key, RLS is bypassed for
every call made through this module. Do not expose any function here
directly to the frontend without an explicit, separate permission check
in chat_service.py. See the project's standing principle: "service role
key bypasses RLS -- always add explicit Python-layer ownership checks."
"""

from __future__ import annotations

import os
from typing import Any, Optional

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"]  # e.g. https://qmmanlhtbgxekzbtlgsn.supabase.co
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}


class SupabaseCallError(RuntimeError):
    pass


def call_rpc(fn_name: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Calls a Postgres function via PostgREST's /rpc/ endpoint.
    Always returns a list of row dicts (Supabase RPCs that return a single
    row still come back as a one-element list)."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn_name}"
    resp = requests.post(url, headers=_HEADERS, json=params, timeout=30)
    if not resp.ok:
        raise SupabaseCallError(f"RPC {fn_name} failed ({resp.status_code}): {resp.text}")
    data = resp.json()
    if isinstance(data, list):
        return data
    return [data] if data is not None else []


def select_table(
    table: str,
    *,
    columns: str = "*",
    filters: Optional[dict[str, Any]] = None,
    order_by: Optional[str] = None,
    descending: bool = False,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Calls PostgREST's table SELECT endpoint with simple equality filters."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    query: dict[str, Any] = {"select": columns}
    if filters:
        for col, val in filters.items():
            query[col] = f"eq.{val}"
    if order_by:
        query["order"] = f"{order_by}.{'desc' if descending else 'asc'}"
    if limit:
        query["limit"] = str(limit)

    resp = requests.get(url, headers=_HEADERS, params=query, timeout=30)
    if not resp.ok:
        raise SupabaseCallError(f"SELECT {table} failed ({resp.status_code}): {resp.text}")
    return resp.json()


def insert_row(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {**_HEADERS, "Prefer": "return=representation"}
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    if not resp.ok:
        raise SupabaseCallError(f"INSERT {table} failed ({resp.status_code}): {resp.text}")
    data = resp.json()
    return data[0] if isinstance(data, list) else data
