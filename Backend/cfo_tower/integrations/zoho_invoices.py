"""
Syncs invoices from Zoho Books into the raw_zoho_invoices table.

This is a RAW sync — data goes in exactly as Zoho returns it, no
transformation, no mapping to internal customer/project IDs. That
mapping happens later in the Mapping Workbench (Sprint 4 territory).

Designed to be called:
- Manually, for the first backfill
- On a schedule (every 2 hours) once wired into cfo_server.py's
  background scheduler
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_invoice_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # service role, not anon — backend only

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column — convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _invoice_to_row(invoice: dict, batch_id: str) -> dict:
    """Map a single Zoho invoice JSON object to a raw_zoho_invoices row."""
    return {
        "zoho_invoice_id": invoice["invoice_id"],
        "invoice_number": invoice.get("invoice_number"),
        "customer_name": invoice.get("customer_name"),
        "customer_id_zoho": invoice.get("customer_id"),
        "invoice_date": _clean_date(invoice.get("date")),
        "due_date": _clean_date(invoice.get("due_date")),
        "total": invoice.get("total"),
        "balance": invoice.get("balance"),
        "status": invoice.get("status"),
        "currency_code": invoice.get("currency_code", "INR"),
        "line_items": invoice.get("line_items", []),
        "raw_payload": invoice,
        "sync_batch_id": batch_id,
    }


def sync_invoices(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all invoices from Zoho Books (paginated) and upserts them
    into raw_zoho_invoices. Returns a summary dict for logging.
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
            response = zoho_books_get("invoices", {"page": page, "per_page": page_size})
            invoices = response.get("invoices", [])

            if not invoices:
                break

            total_fetched += len(invoices)
            rows = [_invoice_to_row(inv, batch_id) for inv in invoices]

            try:
                result = supabase.table("raw_zoho_invoices").upsert(
                    rows, on_conflict="zoho_invoice_id"
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
            f"Zoho invoice sync complete: {total_fetched} fetched, "
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
        logger.exception("Zoho invoice sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    # Manual run for first backfill / testing:
    #   cd cfo_tower
    #   python -m integrations.zoho_invoices
    result = sync_invoices()
    print(result)
