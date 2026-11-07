"""
Syncs Tasks from Zoho CRM into raw_zoho_crm_tasks.

FIELD NAMES UNVERIFIED against live data -- written from Zoho CRM v6's
documented Tasks module shape. First real sync may surface a mismatch
(same class of issue as Deals' Closing_Date empty-string handling).

Place at: cfo_tower/integrations/zoho_crm_tasks.py
Add to sync_all.py's SYNC_STEPS alongside zoho_crm_opportunities.

Requires the rescoped CRM refresh token (ZohoCRM.modules.tasks.READ) --
run after confirming the OAuth rescope, not before.
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_crm_auth import zoho_crm_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_crm_task_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

TASK_FIELDS = "Subject,Status,Due_Date,Priority,What_Id,Owner,Created_Time,Modified_Time"
_PAGE_FETCH_DELAY_SECONDS = 0.2


def _clean_date(value):
    if value in (None, "", "null"):
        return None
    return value


def _task_to_row(task: dict, batch_id: str) -> dict:
    owner = task.get("Owner") or {}
    what = task.get("What_Id") or {}
    return {
        "zoho_task_id": task["id"],
        "subject": task.get("Subject"),
        "status": task.get("Status"),
        "due_date": _clean_date(task.get("Due_Date")),
        "priority": task.get("Priority"),
        "deal_id_zoho": what.get("id"),  # only meaningful if What_Id points at a Deal
        "owner_id_zoho": owner.get("id"),
        "owner_name": owner.get("name"),
        "created_time": task.get("Created_Time"),
        "modified_time": task.get("Modified_Time"),
        "raw_payload": task,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "sync_batch_id": batch_id,
    }


def sync_crm_tasks(page_size: int = 200, max_pages: int = 50) -> dict:
    batch_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_crm_tasks",
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
            response = zoho_crm_get("Tasks", {
                "fields": TASK_FIELDS, "per_page": page_size, "page": page,
            })
            tasks = response.get("data", [])
            if not tasks:
                break

            total_fetched += len(tasks)
            rows = [_task_to_row(t, batch_id) for t in tasks]

            try:
                result = supabase.table("raw_zoho_crm_tasks").upsert(
                    rows, on_conflict="zoho_task_id"
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
        logger.exception("Zoho CRM task sync failed")
        supabase.table("sync_logs").update({
            "status": "failed", "records_fetched": total_fetched,
            "records_inserted": total_upserted, "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    print(sync_crm_tasks())
