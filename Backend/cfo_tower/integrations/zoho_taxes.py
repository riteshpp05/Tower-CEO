"""
Syncs the Taxes settings list from Zoho Books into zoho_taxes.
This is what resolves a contact's tds_tax_id to an actual percentage.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_taxes
"""

import os
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_taxes_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def sync_taxes() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_books",
        "sync_type": "manual",
        "status": "running",
        "started_at": started_at,
    }).execute()
    sync_log_id = sync_log.data[0]["id"]

    try:
        response = zoho_books_get("settings/taxes")
        taxes = response.get("taxes", [])

        rows = [{
            "zoho_tax_id": t.get("tax_id"),
            "tax_name": t.get("tax_name"),
            "tax_percentage": t.get("tax_percentage"),
            "tax_type": t.get("tax_type"),
        } for t in taxes]

        upserted = 0
        if rows:
            result = supabase.table("zoho_taxes").upsert(rows, on_conflict="zoho_tax_id").execute()
            upserted = len(result.data)

        supabase.table("sync_logs").update({
            "status": "success",
            "records_fetched": len(taxes),
            "records_inserted": upserted,
            "records_failed": 0,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()

        logger.info(f"Zoho taxes sync complete: {len(taxes)} found, {upserted} upserted")
        return {"status": "success", "found": len(taxes), "upserted": upserted}

    except Exception as e:
        logger.exception("Zoho taxes sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_taxes()
    print(result)
