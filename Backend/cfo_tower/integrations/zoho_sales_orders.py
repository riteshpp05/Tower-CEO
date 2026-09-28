"""
Syncs sales orders from Zoho Books into raw_zoho_sales_orders.

Sales orders precede invoices in the document flow. RAW sync,
no transformation — mapping/promotion happens later, same as
invoices and vendor bills.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_sales_orders

LINE ITEMS FIX (added after discovering all 331 previously-synced SOs had
an empty line_items array, confirmed via:
    select jsonb_typeof(line_items), jsonb_array_length(line_items), count(*)
    from raw_zoho_sales_orders group by 1,2;
-> every row came back as an empty array):

Zoho Books' LIST endpoint (GET /salesorders) returns lightweight summary
objects for each sales order and does NOT include the line_items
breakdown at all -- this is standard, documented Zoho API behavior, the
same "list is a summary, get-by-id is full detail" pattern most REST APIs
with nested/expensive sub-objects use. The full line_items array is only
present on the single-record DETAIL endpoint (GET /salesorders/{id}).

This sync previously only ever called the list endpoint and trusted
so.get("line_items", []) on the summary object -- the key is genuinely
absent there, not occasionally missing, so it silently fell back to []
on every single sales order, every sync, with no error at all.

The fix: after fetching each page of summaries, make one additional
per-record detail call to retrieve the real line_items, then merge that
into the row before upserting. This roughly doubles the number of API
calls this sync makes (one extra GET per sales order) -- a small
inter-call delay (_DETAIL_FETCH_DELAY_SECONDS) is added as a conservative
default against Zoho's per-minute rate limits; tune it down if your
Zoho plan's rate limit comfortably allows faster calls.
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_sales_order_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Conservative delay between per-record detail calls, to avoid tripping
# Zoho's per-minute API rate limit now that this sync makes roughly
# twice as many calls as before (one list call per page, plus one detail
# call per sales order). Lower this if your Zoho plan's rate limit allows
# faster calls without 429 errors; raise it if you start seeing them.
_DETAIL_FETCH_DELAY_SECONDS = 0.2


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column — convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _fetch_line_items(salesorder_id) -> list:
    """Fetches the full detail object for one sales order and returns its
    line_items array. Returns [] (and logs a warning, does not raise) if
    the detail call fails for an individual record -- a single bad/edge-
    case SO should not abort the entire sync; it just keeps that one row's
    line_items empty, same as before this fix, rather than blocking
    everything else from syncing correctly.
    """
    try:
        detail = zoho_books_get(f"salesorders/{salesorder_id}")
        # Single-record GET responses use the SINGULAR key "salesorder",
        # unlike the list endpoint's plural "salesorders" -- confirmed via
        # Zoho's own API documentation. Using the wrong key here would
        # silently return [] again via .get()'s default, recreating the
        # exact bug this fix exists to solve.
        return detail.get("salesorder", {}).get("line_items", [])
    except Exception as e:
        logger.warning(f"Could not fetch line items for SO {salesorder_id}: {e}")
        return []


def _salesorder_to_row(so: dict, batch_id: str, line_items: list) -> dict:
    """Map a single Zoho sales order JSON object to a raw_zoho_sales_orders row.
    line_items is now passed in explicitly (fetched separately via the
    detail endpoint) rather than read from `so` itself, since the summary
    object from the list endpoint never has it populated."""
    return {
        "zoho_salesorder_id": so["salesorder_id"],
        "salesorder_number": so.get("salesorder_number"),
        "customer_name": so.get("customer_name"),
        "customer_id_zoho": so.get("customer_id"),
        "order_date": _clean_date(so.get("date")),
        "shipment_date": _clean_date(so.get("shipment_date")),
        "total": so.get("total"),
        "currency_code": so.get("currency_code", "INR"),
        "exchange_rate": so.get("exchange_rate", 1),
        "status": so.get("status"),
        "line_items": line_items,
        "raw_payload": so,
        "sync_batch_id": batch_id,
    }


def sync_sales_orders(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all sales orders from Zoho Books (paginated) and upserts
    them into raw_zoho_sales_orders. Returns a summary dict for logging.
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
            response = zoho_books_get("salesorders", {"page": page, "per_page": page_size})
            sales_orders = response.get("salesorders", [])

            if not sales_orders:
                break

            total_fetched += len(sales_orders)

            rows = []
            for so in sales_orders:
                line_items = _fetch_line_items(so["salesorder_id"])
                rows.append(_salesorder_to_row(so, batch_id, line_items))
                time.sleep(_DETAIL_FETCH_DELAY_SECONDS)

            try:
                result = supabase.table("raw_zoho_sales_orders").upsert(
                    rows, on_conflict="zoho_salesorder_id"
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
            f"Zoho sales order sync complete: {total_fetched} fetched, "
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
        logger.exception("Zoho sales order sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_sales_orders()
    print(result)