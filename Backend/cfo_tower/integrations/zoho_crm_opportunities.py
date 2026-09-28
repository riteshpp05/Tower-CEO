"""
Syncs deals from Zoho CRM into raw_zoho_crm_deals.

CORRECTED from the earlier draft: raw_zoho_crm_deals already exists in the
schema (created ahead of time, likely alongside opportunities in migration
003 — opportunities.raw_deal_id already FKs to it, and zoho_deal_id is
already unique on both tables). This sync module writes into that existing
table using its real column names, rather than a new table.

RAW sync, no transformation — same principle as every Books sync module.
Promotion into `opportunities` happens via a DB trigger on raw_zoho_crm_deals
(see 029_zoho_crm_integration.sql), not from this script.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_crm_opportunities

Place at: cfo_tower/integrations/zoho_crm_opportunities.py
Add to sync_all.py's SYNC_STEPS as a 14th step (see note at bottom of file).
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_crm_auth import zoho_crm_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_crm_deal_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # matches every other integrations/*.py

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Added Created_Time/Modified_Time to match raw_zoho_crm_deals' real columns
# (created_time, modified_time) -- these are Zoho CRM's own system fields,
# not sync timestamps.
DEAL_FIELDS = "Deal_Name,Account_Name,Stage,Amount,Probability,Closing_Date,Owner,Created_Time,Modified_Time"

_PAGE_FETCH_DELAY_SECONDS = 0.2


def _clean_date(value):
    """Zoho returns empty string for unset date fields, not null.
    Postgres rejects '' for a date column -- convert to None."""
    if value in (None, "", "null"):
        return None
    return value


def _deal_to_row(deal: dict, batch_id: str) -> dict:
    """Map a single Zoho CRM Deal JSON object to a raw_zoho_crm_deals row.
    Column names here match the REAL table exactly (account_id_zoho, not
    zoho_account_id; owner_name only -- no owner_id/owner_email columns
    exist on this table, though the full Owner object is still preserved
    in raw_payload if you need it later)."""
    owner = deal.get("Owner") or {}
    account = deal.get("Account_Name") or {}
    return {
        "zoho_deal_id": deal["id"],
        "deal_name": deal.get("Deal_Name"),
        "account_name": account.get("name"),
        "account_id_zoho": account.get("id"),
        "stage": deal.get("Stage"),
        "amount": deal.get("Amount"),
        "probability": deal.get("Probability"),
        "closing_date": _clean_date(deal.get("Closing_Date")),
        "owner_name": owner.get("name"),
        "owner_id_zoho": owner.get("id"),  # Zoho's real internal owner ID, added in migration 030
        "created_time": deal.get("Created_Time"),
        "modified_time": deal.get("Modified_Time"),
        "raw_payload": deal,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "sync_batch_id": batch_id,
    }


def sync_crm_opportunities(page_size: int = 200, max_pages: int = 50) -> dict:
    """
    Fetches all deals from Zoho CRM (paginated) and upserts them into
    raw_zoho_crm_deals. Returns a summary dict for logging -- same shape
    as sync_sales_orders() etc.
    """
    batch_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_crm",        # must match KNOWN_SOURCES key in IntegrationPage.tsx exactly
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
            response = zoho_crm_get("Deals", {
                "fields": DEAL_FIELDS,
                "per_page": page_size,
                "page": page,
            })
            deals = response.get("data", [])

            if not deals:
                break

            total_fetched += len(deals)
            rows = [_deal_to_row(d, batch_id) for d in deals]

            try:
                result = supabase.table("raw_zoho_crm_deals").upsert(
                    rows, on_conflict="zoho_deal_id"
                ).execute()
                total_upserted += len(result.data)
            except Exception as e:
                logger.error(f"Upsert failed for page {page}: {e}")
                total_failed += len(rows)

            if not response.get("info", {}).get("more_records"):
                break
            page += 1
            time.sleep(_PAGE_FETCH_DELAY_SECONDS)

        supabase.table("sync_logs").update({
            "status": "success" if total_failed == 0 else "partial",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "records_failed": total_failed,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()

        logger.info(
            f"Zoho CRM deal sync complete: {total_fetched} fetched, "
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
        logger.exception("Zoho CRM deal sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_crm_opportunities()
    print(result)


# --- Wiring into sync_all.py (add these two lines) -------------------------
#
# from .zoho_crm_opportunities import sync_crm_opportunities
#
# and add to SYNC_STEPS:
#     ("CRM Opportunities",  sync_crm_opportunities),