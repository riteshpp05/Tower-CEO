"""
Syncs Notes from Zoho CRM into raw_zoho_crm_notes.

FIELD NAMES UNVERIFIED against live data. Notes' linkage differs from
Tasks/Events/Calls: instead of a top-level What_Id, Notes use Parent_Id
(a nested object) -- CORRECTED after seeing real data: the related
module name lives at Parent_Id.module.api_name (e.g. "Deals"), not a
separate top-level se_module field as originally assumed. deal_id_zoho
is only populated when that nested api_name is 'Deals' -- a note on a
Contact or Account will have deal_id_zoho = NULL, which is correct.

Place at: cfo_tower/integrations/zoho_crm_notes.py
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_crm_auth import zoho_crm_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_crm_note_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

NOTE_FIELDS = "Note_Title,Note_Content,Parent_Id,Owner,Created_Time,Modified_Time"
# CORRECTED: there is no top-level se_module field on a Note -- confirmed
# against a real synced payload. The module a note is attached to lives
# nested at Parent_Id.module.api_name instead. Requesting "se_module" as
# a field name was silently ignored by Zoho (no error, just absent from
# every response), which is why deal_id_zoho came back null for all 632
# existing rows -- not because the notes weren't attached to deals.
_PAGE_FETCH_DELAY_SECONDS = 0.2


def _note_to_row(note: dict, batch_id: str) -> dict:
    owner = note.get("Owner") or {}
    parent = note.get("Parent_Id") or {}
    parent_module = (parent.get("module") or {}).get("api_name")
    return {
        "zoho_note_id": note["id"],
        "note_title": note.get("Note_Title"),
        "note_content": note.get("Note_Content"),
        "deal_id_zoho": parent.get("id") if parent_module == "Deals" else None,
        "owner_id_zoho": owner.get("id"),
        "owner_name": owner.get("name"),
        "created_time": note.get("Created_Time"),
        "modified_time": note.get("Modified_Time"),
        "raw_payload": note,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "sync_batch_id": batch_id,
    }


def sync_crm_notes(page_size: int = 200, max_pages: int = 50) -> dict:
    batch_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_crm_notes",
        "sync_type": "manual",
        "batch_id": batch_id,
        "status": "running",
        "started_at": started_at,
    }).execute()
    sync_log_id = sync_log.data[0]["id"]

    total_fetched = total_upserted = total_failed = 0
    page = 1

    try:
        while page <= max_pages:
            response = zoho_crm_get("Notes", {
                "fields": NOTE_FIELDS, "per_page": page_size, "page": page,
            })
            notes = response.get("data", [])
            if not notes:
                break

            total_fetched += len(notes)
            rows = [_note_to_row(n, batch_id) for n in notes]

            try:
                result = supabase.table("raw_zoho_crm_notes").upsert(
                    rows, on_conflict="zoho_note_id"
                ).execute()
                total_upserted += len(result.data)
            except Exception as e:
                logger.error(f"Upsert failed for page {page}: {e}")
                total_failed += len(rows)

            if not response.get("info", {}).get("more_records"):
                break
            page += 1
            time.sleep(_PAGE_FETCH_DELAY_SECONDS)

        supabase.table("sync_logs").update({
            "status": "success" if total_failed == 0 else "partial",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "records_failed": total_failed,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()

        return {"status": "success" if total_failed == 0 else "partial",
                "fetched": total_fetched, "upserted": total_upserted, "failed": total_failed}

    except Exception as e:
        logger.exception("Zoho CRM note sync failed")
        supabase.table("sync_logs").update({
            "status": "failed", "records_fetched": total_fetched,
            "records_inserted": total_upserted, "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    print(sync_crm_notes())