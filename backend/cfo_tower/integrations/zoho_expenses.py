"""
Syncs expenses from Zoho Books into raw_zoho_expenses.

Not actively used by AIS today per the user, but synced now so the
data is captured from the moment it starts being used, with zero
catch-up needed later.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_expenses
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_expenses_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _clean_date(value):
    if value in (None, "", "null"):
        return None
    return value


def _expense_to_row(exp, batch_id):
    return {
        "zoho_expense_id": exp["expense_id"],
        "expense_date": _clean_date(exp.get("date")),
        "paid_through_account": exp.get("paid_through_account_name"),
        "amount": exp.get("total"),
        "vendor_name": exp.get("vendor_name"),
        "vendor_id_zoho": exp.get("vendor_id"),
        "is_billable": exp.get("is_billable", False),
        "customer_id_zoho": exp.get("customer_id"),
        "currency_code": exp.get("currency_code", "INR"),
        "exchange_rate": exp.get("exchange_rate", 1),
        "status": exp.get("status"),
        "raw_payload": exp,
        "sync_batch_id": batch_id,
    }


def sync_expenses(page_size: int = 200, max_pages: int = 50) -> dict:
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
            response = zoho_books_get("expenses", {"page": page, "per_page": page_size})
            expenses = response.get("expenses", [])

            if not expenses:
                break

            total_fetched += len(expenses)
            rows = [_expense_to_row(e, batch_id) for e in expenses]

            try:
                result = supabase.table("raw_zoho_expenses").upsert(
                    rows, on_conflict="zoho_expense_id"
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
            f"Zoho expenses sync complete: {total_fetched} fetched, "
            f"{total_upserted} upserted, {total_failed} failed"
        )
        return {
            "status": "success" if total_failed == 0 else "partial",
            "fetched": total_fetched, "upserted": total_upserted, "failed": total_failed,
        }

    except Exception as e:
        logger.exception("Zoho expenses sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_expenses()
    print(result)
