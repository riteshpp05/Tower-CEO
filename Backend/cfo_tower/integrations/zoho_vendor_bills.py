"""
Syncs vendor bills from Zoho Books into the raw_zoho_vendor_bills table.

Same pattern as zoho_invoices.py: RAW sync, no transformation, no
mapping to internal vendor/project IDs (that's the Mapping Workbench's
job, Sprint 4 territory).

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_vendor_bills

LINE ITEMS FIX (third occurrence of the same root cause already found
and fixed in zoho_sales_orders.py and zoho_purchase_orders.py -- see
those files' docstrings for the full explanation):

Zoho Books' LIST endpoint (GET /bills) returns lightweight summary
objects and does NOT include the line_items breakdown -- confirmed via
Zoho's own API documentation, which lists "Get a bill" (GET
/bills/{bill_id}) as a genuinely separate endpoint from the list. This
sync previously only called the list endpoint and trusted
bill.get("line_items", []) on the summary object -- the key is genuinely
absent there, so it silently fell back to [] on every vendor bill, every
sync, with no error. Confirmed via SQL: every previously-synced bill had
an empty line_items array, same symptom as the other two syncs before
their fixes.

Fixed the same way: one additional per-record detail call per bill,
merged in before upserting.
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_vendor_bill_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Same conservative default as the other two fixed syncs -- this sync now
# makes roughly twice as many API calls (one detail call per bill, on top
# of the list calls). Tune down if your Zoho plan's rate limit comfortably
# allows faster calls; raise it if you start seeing 429 errors.
_DETAIL_FETCH_DELAY_SECONDS = 0.2


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column — convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _fetch_line_items(bill_id) -> list:
    """Fetches the full detail object for one bill and returns its
    line_items array. Returns [] (and logs a warning, does not raise) if
    the detail call fails for an individual record -- a single bad record
    should not abort the entire sync."""
    try:
        detail = zoho_books_get(f"bills/{bill_id}")
        # Single-record GET responses use the SINGULAR key "bill", unlike
        # the list endpoint's plural "bills" -- same singular/plural
        # distinction confirmed for sales orders and purchase orders.
        return detail.get("bill", {}).get("line_items", [])
    except Exception as e:
        logger.warning(f"Could not fetch line items for bill {bill_id}: {e}")
        return []


def _bill_to_row(bill: dict, batch_id: str, line_items: list) -> dict:
    """Map a single Zoho vendor bill JSON object to a raw_zoho_vendor_bills
    row. line_items is now passed in explicitly (fetched separately via
    the detail endpoint) rather than read from `bill` itself, since the
    summary object from the list endpoint never has it populated."""
    return {
        "zoho_bill_id": bill["bill_id"],
        "bill_number": bill.get("bill_number"),
        "vendor_name": bill.get("vendor_name"),
        "vendor_id_zoho": bill.get("vendor_id"),
        "bill_date": _clean_date(bill.get("date")),
        "due_date": _clean_date(bill.get("due_date")),
        "total": bill.get("total"),
        "balance": bill.get("balance"),
        "status": bill.get("status"),
        "line_items": line_items,
        "raw_payload": bill,
        "sync_batch_id": batch_id,
    }


def sync_vendor_bills(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all vendor bills from Zoho Books (paginated) and upserts them
    into raw_zoho_vendor_bills. Returns a summary dict for logging.
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
            # Zoho Books endpoint for vendor bills is "bills", not "vendorbills"
            response = zoho_books_get("bills", {"page": page, "per_page": page_size})
            bills = response.get("bills", [])

            if not bills:
                break

            total_fetched += len(bills)

            rows = []
            for bill in bills:
                line_items = _fetch_line_items(bill["bill_id"])
                rows.append(_bill_to_row(bill, batch_id, line_items))
                time.sleep(_DETAIL_FETCH_DELAY_SECONDS)

            try:
                result = supabase.table("raw_zoho_vendor_bills").upsert(
                    rows, on_conflict="zoho_bill_id"
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
            f"Zoho vendor bill sync complete: {total_fetched} fetched, "
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
        logger.exception("Zoho vendor bill sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_vendor_bills()
    print(result)