"""
Syncs vendor credits from Zoho Books into raw_zoho_vendor_credits.

Mirror of zoho_credit_notes.py for the payables side — explains why
a vendor bill balance is lower than its original total.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_vendor_credits
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_vendor_credit_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column — convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _vendorcredit_to_row(vc: dict, batch_id: str) -> dict:
    """Map a single Zoho vendor credit JSON object to a raw_zoho_vendor_credits row."""
    return {
        "zoho_vendorcredit_id": vc["vendor_credit_id"],
        "vendorcredit_number": vc.get("vendor_credit_number"),
        "vendor_name": vc.get("vendor_name"),
        "vendor_id_zoho": vc.get("vendor_id"),
        "note_date": _clean_date(vc.get("date")),
        "total": vc.get("total"),
        "balance": vc.get("balance"),
        "status": vc.get("status"),
        "currency_code": vc.get("currency_code", "INR"),
        "exchange_rate": vc.get("exchange_rate", 1),
        "bills_credited": vc.get("bills_credited", []),
        "raw_payload": vc,
        "sync_batch_id": batch_id,
    }


def sync_vendor_credits(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all vendor credits from Zoho Books (paginated) and upserts
    them into raw_zoho_vendor_credits. Returns a summary dict for logging.
    """
    batch_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_books",
        "sync_type": "manual",
        "batch_id": batch_id,
        "status": "running",
        "started_at": started_at,
    }).execute()
    sync_log_id = sync_log.data[0]["id"]

    total_fetched = 0
    total_upserted = 0
    total_failed = 0
    page = 1

    try:
        while page <= max_pages:
            response = zoho_books_get("vendorcredits", {"page": page, "per_page": page_size})
            vendor_credits = response.get("vendor_credits", [])

            if not vendor_credits:
                break

            total_fetched += len(vendor_credits)
            rows = [_vendorcredit_to_row(vc, batch_id) for vc in vendor_credits]

            try:
                result = supabase.table("raw_zoho_vendor_credits").upsert(
                    rows, on_conflict="zoho_vendorcredit_id"
                ).execute()
                total_upserted += len(result.data)
            except Exception as e:
                logger.error(f"Upsert failed for page {page}: {e}")
                total_failed += len(rows)

            page_context = response.get("page_context", {})
            if not page_context.get("has_more_page"):
                break
            page += 1

        supabase.table("sync_logs").update({
            "status": "success" if total_failed == 0 else "partial",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "records_failed": total_failed,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()

        logger.info(
            f"Zoho vendor credit sync complete: {total_fetched} fetched, "
            f"{total_upserted} upserted, {total_failed} failed"
        )
        return {
            "status": "success" if total_failed == 0 else "partial",
            "fetched": total_fetched,
            "upserted": total_upserted,
            "failed": total_failed,
            "batch_id": batch_id,
        }

    except Exception as e:
        logger.exception("Zoho vendor credit sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_vendor_credits()
    print(result)
