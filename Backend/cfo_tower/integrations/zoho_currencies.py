"""
Syncs currency list and current exchange rates from Zoho Books into
the `currencies` and `exchange_rate_history` reference tables.

Zoho's /settings/currencies endpoint returns the CURRENT rate per
currency, not a full historical series. Running this sync daily
(or whenever invoked) builds up exchange_rate_history naturally —
one row per currency per day it was run, which is exactly what's
needed to normalize amounts to INR at "the rate that applied around
that time" for chatbot queries.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_currencies
"""

import os
import logging
from datetime import datetime, timezone, date
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_currency_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def sync_currencies() -> dict:
    """
    Fetches the current currency list (with rates) from Zoho Books,
    upserts into `currencies`, and records today's rate into
    `exchange_rate_history`.
    """
    started_at = datetime.now(timezone.utc).isoformat()

    sync_log = supabase.table("sync_logs").insert({
        "source": "zoho_books",
        "sync_type": "manual",
        "status": "running",
        "started_at": started_at,
    }).execute()
    sync_log_id = sync_log.data[0]["id"]

    today = date.today().isoformat()
    currencies_upserted = 0
    rates_recorded = 0

    try:
        response = zoho_books_get("settings/currencies")
        currencies = response.get("currencies", [])

        currency_rows = []
        rate_rows = []

        for c in currencies:
            currency_rows.append({
                "zoho_currency_id": c.get("currency_id"),
                "currency_code": c.get("currency_code"),
                "currency_name": c.get("currency_name"),
                "currency_symbol": c.get("currency_symbol"),
                "is_base_currency": c.get("is_base_currency", False),
            })
            # Base currency rate to itself is always 1 — record it too,
            # so every currency_code used elsewhere has a row here.
            rate_rows.append({
                "currency_code": c.get("currency_code"),
                "effective_date": today,
                "rate_to_base": c.get("exchange_rate", 1),
                "source": "zoho_books",
            })

        if currency_rows:
            result = supabase.table("currencies").upsert(
                currency_rows, on_conflict="currency_code"
            ).execute()
            currencies_upserted = len(result.data)

        if rate_rows:
            result = supabase.table("exchange_rate_history").upsert(
                rate_rows, on_conflict="currency_code,effective_date"
            ).execute()
            rates_recorded = len(result.data)

        supabase.table("sync_logs").update({
            "status": "success",
            "records_fetched": len(currencies),
            "records_inserted": currencies_upserted + rates_recorded,
            "records_failed": 0,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()

        logger.info(
            f"Zoho currency sync complete: {len(currencies)} currencies found, "
            f"{currencies_upserted} currency rows upserted, "
            f"{rates_recorded} rate-history rows recorded for {today}"
        )
        return {
            "status": "success",
            "currencies_found": len(currencies),
            "currencies_upserted": currencies_upserted,
            "rates_recorded": rates_recorded,
            "effective_date": today,
        }

    except Exception as e:
        logger.exception("Zoho currency sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_currencies()
    print(result)
