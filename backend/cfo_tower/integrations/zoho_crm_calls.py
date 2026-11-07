"""
Syncs Calls from Zoho CRM into raw_zoho_crm_calls.

FIELD NAMES UNVERIFIED against live data. Call_Duration is stored as
Zoho's raw "HH:MM:SS" text -- deliberately not parsed into an interval
here, since we don't yet know if any duration-based metric is needed;
easy to add a parsed numeric-seconds column later if so.

Place at: cfo_tower/integrations/zoho_crm_calls.py
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_crm_auth import zoho_crm_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_crm_call_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

CALL_FIELDS = "Subject,Call_Type,Call_Duration,Call_Start_Time,What_Id,Owner,Created_Time,Modified_Time"
_PAGE_FETCH_DELAY_SECONDS = 0.2


def _call_to_row(call: dict, batch_id: str) -> dict:
    owner = call.get("Owner") or {}
    what = call.get("What_Id") or {}
    return {
        "zoho_call_id": call["id"],
        "subject": call.get("Subject"),
        "call_type": call.get("Call_Type"),
        "call_duration": call.get("Call_Duration"),
        "call_start_time": call.get("Call_Start_Time"),
        "deal_id_zoho": what.get("id"),
        "owner_id_zoho": owner.get("id"),
        "owner_name": owner.get("name"),
        "created_time": call.get("Created_Time"),
        "modified_time": call.get("Modified_Time"),
        "raw_payload": call,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "sync_batch_id": batch_id,
    }


def sync_crm_calls(page_size: int = 200, max_pages: int = 50) -> dict:
    batch_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_crm_calls",
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
            response = zoho_crm_get("Calls", {
                "fields": CALL_FIELDS, "per_page": page_size, "page": page,
            })
            calls = response.get("data", [])
            if not calls:
                break

            total_fetched += len(calls)
            rows = [_call_to_row(c, batch_id) for c in calls]

            try:
                result = supabase.table("raw_zoho_crm_calls").upsert(
                    rows, on_conflict="zoho_call_id"
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
        logger.exception("Zoho CRM call sync failed")
        supabase.table("sync_logs").update({
            "status": "failed", "records_fetched": total_fetched,
            "records_inserted": total_upserted, "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    print(sync_crm_calls())
