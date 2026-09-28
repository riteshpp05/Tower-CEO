"""
Syncs purchase orders from Zoho Books into raw_zoho_purchase_orders.

Purchase orders precede vendor bills in the procurement flow, similar
to how sales orders precede invoices. RAW sync, no transformation.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_purchase_orders

LINE ITEMS FIX (same root cause and fix as zoho_sales_orders.py -- see
that file's docstring for the full explanation):

Zoho Books' LIST endpoint (GET /purchaseorders) returns lightweight
summary objects and does NOT include the line_items breakdown -- only
the per-record DETAIL endpoint (GET /purchaseorders/{id}) returns it.
Confirmed via Zoho's own API documentation, which lists these as two
genuinely separate endpoints ("List purchase orders" vs "Get a purchase
order"), the same pattern already confirmed and fixed for sales orders.

This sync previously only called the list endpoint and trusted
po.get("line_items", []) on the summary object -- the key is genuinely
absent there, so it silently fell back to [] on every purchase order,
every sync, with no error. Fixed the same way: one additional per-record
detail call per purchase order, merged in before upserting.
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_purchase_order_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Same conservative default as zoho_sales_orders.py -- this sync now makes
# roughly twice as many API calls (one detail call per PO, on top of the
# list calls). Tune down if your Zoho plan's rate limit comfortably allows
# faster calls; raise it if you start seeing 429 errors.
_DETAIL_FETCH_DELAY_SECONDS = 0.2


def _clean_date(value):
    if value in (None, "", "null"):
        return None
    return value


def _fetch_line_items(purchaseorder_id) -> list:
    """Fetches the full detail object for one purchase order and returns
    its line_items array. Returns [] (and logs a warning, does not raise)
    if the detail call fails for an individual record -- a single bad
    record should not abort the entire sync."""
    try:
        detail = zoho_books_get(f"purchaseorders/{purchaseorder_id}")
        # Single-record GET responses use the SINGULAR key "purchaseorder",
        # unlike the list endpoint's plural "purchaseorders" -- same
        # singular/plural distinction confirmed for sales orders.
        return detail.get("purchaseorder", {}).get("line_items", [])
    except Exception as e:
        logger.warning(f"Could not fetch line items for PO {purchaseorder_id}: {e}")
        return []


def _po_to_row(po, batch_id, line_items: list):
    """line_items is now passed in explicitly (fetched separately via the
    detail endpoint) rather than read from `po` itself, since the summary
    object from the list endpoint never has it populated."""
    return {
        "zoho_purchaseorder_id": po["purchaseorder_id"],
        "purchaseorder_number": po.get("purchaseorder_number"),
        "vendor_name": po.get("vendor_name"),
        "vendor_id_zoho": po.get("vendor_id"),
        "order_date": _clean_date(po.get("date")),
        "delivery_date": _clean_date(po.get("delivery_date")),
        "total": po.get("total"),
        "currency_code": po.get("currency_code", "INR"),
        "exchange_rate": po.get("exchange_rate", 1),
        "status": po.get("status"),
        "line_items": line_items,
        "raw_payload": po,
        "sync_batch_id": batch_id,
    }


def sync_purchase_orders(page_size: int = 200, max_pages: int = 50) -> dict:
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
            response = zoho_books_get("purchaseorders", {"page": page, "per_page": page_size})
            purchase_orders = response.get("purchaseorders", [])

            if not purchase_orders:
                break

            total_fetched += len(purchase_orders)

            rows = []
            for po in purchase_orders:
                line_items = _fetch_line_items(po["purchaseorder_id"])
                rows.append(_po_to_row(po, batch_id, line_items))
                time.sleep(_DETAIL_FETCH_DELAY_SECONDS)

            try:
                result = supabase.table("raw_zoho_purchase_orders").upsert(
                    rows, on_conflict="zoho_purchaseorder_id"
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
            f"Zoho purchase order sync complete: {total_fetched} fetched, "
            f"{total_upserted} upserted, {total_failed} failed"
        )
        return {
            "status": "success" if total_failed == 0 else "partial",
            "fetched": total_fetched, "upserted": total_upserted, "failed": total_failed,
        }

    except Exception as e:
        logger.exception("Zoho purchase order sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_purchase_orders()
    print(result)