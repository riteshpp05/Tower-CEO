"""
Syncs vendor payments from Zoho Books into raw_zoho_vendor_payments.

Mirror of zoho_customer_payments.py for the payables side — answers
"have we actually paid this vendor" beyond just the bill balance.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_vendor_payments
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_vendor_payment_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column — convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _payment_to_row(payment: dict, batch_id: str) -> dict:
    """Map a single Zoho vendor payment JSON object to a raw_zoho_vendor_payments row."""
    return {
        "zoho_payment_id": payment["payment_id"],
        "vendor_name": payment.get("vendor_name"),
        "vendor_id_zoho": payment.get("vendor_id"),
        "payment_mode": payment.get("payment_mode"),
        "amount": payment.get("amount"),
        "bank_charges": payment.get("bank_charges"),
        "payment_date": _clean_date(payment.get("date")),
        "reference_number": payment.get("reference_number"),
        "currency_code": payment.get("currency_code", "INR"),
        "exchange_rate": payment.get("exchange_rate", 1),
        "bills_applied": payment.get("bills", []),
        "raw_payload": payment,
        "sync_batch_id": batch_id,
    }


def sync_vendor_payments(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all vendor payments from Zoho Books (paginated) and upserts
    them into raw_zoho_vendor_payments. Returns a summary dict for logging.
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
            response = zoho_books_get("vendorpayments", {"page": page, "per_page": page_size})
            payments = response.get("vendorpayments", [])

            if not payments:
                break

            total_fetched += len(payments)
            rows = [_payment_to_row(p, batch_id) for p in payments]

            try:
                result = supabase.table("raw_zoho_vendor_payments").upsert(
                    rows, on_conflict="zoho_payment_id"
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
            f"Zoho vendor payment sync complete: {total_fetched} fetched, "
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
        logger.exception("Zoho vendor payment sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_vendor_payments()
    print(result)
