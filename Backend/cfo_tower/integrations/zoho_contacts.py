"""
Syncs contacts (customers + vendors) from Zoho Books into
raw_zoho_contacts, capturing each contact's tds_tax_id — the
field that resolves to a real TDS percentage via zoho_taxes.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_contacts
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_contacts_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _contact_to_row(contact: dict, batch_id: str) -> dict:
    return {
        "zoho_contact_id": contact["contact_id"],
        "contact_name": contact.get("contact_name"),
        "contact_type": contact.get("contact_type"),
        "tds_tax_id": contact.get("tds_tax_id") or None,
        "is_tds_registered": contact.get("is_tds_registered", False),
        "raw_payload": contact,
        "sync_batch_id": batch_id,
    }


def sync_contacts(page_size: int = 200, max_pages: int = 50) -> dict:
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
            response = zoho_books_get("contacts", {"page": page, "per_page": page_size})
            contacts = response.get("contacts", [])

            if not contacts:
                break

            total_fetched += len(contacts)
            rows = [_contact_to_row(c, batch_id) for c in contacts]

            try:
                result = supabase.table("raw_zoho_contacts").upsert(
                    rows, on_conflict="zoho_contact_id"
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
            f"Zoho contacts sync complete: {total_fetched} fetched, "
            f"{total_upserted} upserted, {total_failed} failed"
        )
        return {
            "status": "success" if total_failed == 0 else "partial",
            "fetched": total_fetched,
            "upserted": total_upserted,
            "failed": total_failed,
        }

    except Exception as e:
        logger.exception("Zoho contacts sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_contacts()
    print(result)
