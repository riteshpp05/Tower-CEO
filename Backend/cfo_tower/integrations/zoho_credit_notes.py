"""
Syncs credit notes from Zoho Books into raw_zoho_credit_notes.

Credit notes explain why an invoice balance is lower than its
original total (refunds, write-offs, billing corrections). Without
this, a chatbot sees a reduced balance with no explanation.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_credit_notes
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_credit_note_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column — convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _creditnote_to_row(cn: dict, batch_id: str) -> dict:
    """Map a single Zoho credit note JSON object to a raw_zoho_credit_notes row."""
    return {
        "zoho_creditnote_id": cn["creditnote_id"],
        "creditnote_number": cn.get("creditnote_number"),
        "customer_name": cn.get("customer_name"),
        "customer_id_zoho": cn.get("customer_id"),
        "note_date": _clean_date(cn.get("date")),
        "total": cn.get("total"),
        "balance": cn.get("balance"),
        "status": cn.get("status"),
        "currency_code": cn.get("currency_code", "INR"),
        "exchange_rate": cn.get("exchange_rate", 1),
        "invoices_credited": cn.get("invoices_credited", []),
        "raw_payload": cn,
        "sync_batch_id": batch_id,
    }


def sync_credit_notes(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all credit notes from Zoho Books (paginated) and upserts
    them into raw_zoho_credit_notes. Returns a summary dict for logging.
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
            response = zoho_books_get("creditnotes", {"page": page, "per_page": page_size})
            credit_notes = response.get("creditnotes", [])

            if not credit_notes:
                break

            total_fetched += len(credit_notes)
            rows = [_creditnote_to_row(cn, batch_id) for cn in credit_notes]

            try:
                result = supabase.table("raw_zoho_credit_notes").upsert(
                    rows, on_conflict="zoho_creditnote_id"
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
            f"Zoho credit note sync complete: {total_fetched} fetched, "
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
        logger.exception("Zoho credit note sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_credit_notes()
    print(result)
