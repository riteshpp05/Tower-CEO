"""
Syncs bank transactions from Zoho Books into raw_zoho_bank_transactions.

Covers money movements NOT tied to a customer/vendor invoice payment:
owner contributions, interest income, fund transfers, sales without
invoices, refunds, owner drawings, etc.

Requires looping over each bank/credit-card account since the
banktransactions endpoint is account-scoped.

USAGE:
    cd APNJ-LLM-Studio
    python -m cfo_tower.integrations.zoho_bank_transactions
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from supabase import create_client, Client

from .zoho_auth import zoho_books_get

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("zoho_bank_transactions_sync")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

INFLOW_TYPES = {
    "deposit", "refund", "sales_without_invoices", "owner_contribution",
    "interest_income", "other_income", "sales_return",
}
OUTFLOW_TYPES = {
    "transfer_fund", "card_payment", "expense_refund", "owner_drawings",
}
# These transaction_type values represent the SAME underlying record
# already captured by a dedicated sync (vendor_payments, customer_payments,
# expenses module, vendor bills, vendor credits, journals). Including them
# here would double-count every invoice payment, expense, and bill on
# top of their proper module sync. Excluded entirely — not stored.
DUPLICATE_OF_OTHER_MODULE = {
    "vendor_payment", "customer_payment", "expense", "bill",
    "vendorpayment_refund", "vendor_credit_refund", "payment_refund",
    "journal", "opening_balance",
}


def _clean_date(value):
    if value in (None, "", "null"):
        return None
    return value


def _classify_inflow(transaction_type):
    if transaction_type in INFLOW_TYPES:
        return True
    if transaction_type in OUTFLOW_TYPES:
        return False
    return None


def _is_duplicate_of_other_module(transaction_type):
    return transaction_type in DUPLICATE_OF_OTHER_MODULE


def _get_bank_accounts():
    response = zoho_books_get("bankaccounts")
    return response.get("bankaccounts", [])


def _transaction_to_row(txn, account_name, batch_id):
    txn_type = txn.get("transaction_type")
    return {
        "zoho_transaction_id": txn["transaction_id"],
        "account_id": txn.get("account_id"),
        "account_name": account_name,
        "offset_account_name": txn.get("offset_account_name") or None,
        "transaction_type": txn_type,
        "transaction_date": _clean_date(txn.get("date")),
        "amount": txn.get("amount"),
        "currency_code": txn.get("currency_code", "INR"),
        "exchange_rate": txn.get("exchange_rate", 1),
        "description": txn.get("description"),
        "contact_name": txn.get("party_name") or txn.get("contact_name"),
        "is_inflow": _classify_inflow(txn_type),
        "status": txn.get("status"),
        "raw_payload": txn,
        "sync_batch_id": batch_id,
    }


def sync_bank_transactions(page_size: int = 200, max_pages: int = 50) -> dict:
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
    total_skipped_duplicates = 0

    try:
        accounts = _get_bank_accounts()
        logger.info(f"Found {len(accounts)} bank/credit-card accounts")

        for account in accounts:
            account_id = account.get("account_id")
            account_name = account.get("account_name")
            page = 1

            while page <= max_pages:
                response = zoho_books_get("banktransactions", {
                    "account_id": account_id, "page": page, "per_page": page_size,
                })
                transactions = response.get("banktransactions", [])

                if not transactions:
                    break

                total_fetched += len(transactions)

                # Skip anything that's a duplicate of a module we already
                # sync separately (vendor/customer payments, expenses, bills,
                # journals, refunds, opening balance) — including these here
                # would double-count every invoice payment and expense.
                keep = [t for t in transactions if not _is_duplicate_of_other_module(t.get("transaction_type"))]
                total_skipped_duplicates += len(transactions) - len(keep)

                if not keep:
                    page_context = response.get("page_context", {})
                    if not page_context.get("has_more_page"):
                        break
                    page += 1
                    continue

                rows = [_transaction_to_row(t, account_name, batch_id) for t in keep]

                try:
                    result = supabase.table("raw_zoho_bank_transactions").upsert(
                        rows, on_conflict="zoho_transaction_id"
                    ).execute()
                    total_upserted += len(result.data)
                except Exception as e:
                    logger.error(f"Upsert failed for account {account_name} page {page}: {e}")
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
            f"Zoho bank transactions sync complete: {total_fetched} fetched, "
            f"{total_skipped_duplicates} skipped (duplicate of other module), "
            f"{total_upserted} upserted, {total_failed} failed"
        )
        return {
            "status": "success" if total_failed == 0 else "partial",
            "fetched": total_fetched,
            "skipped_duplicates": total_skipped_duplicates,
            "upserted": total_upserted,
            "failed": total_failed,
        }

    except Exception as e:
        logger.exception("Zoho bank transactions sync failed")
        supabase.table("sync_logs").update({
            "status": "failed",
            "records_fetched": total_fetched,
            "records_inserted": total_upserted,
            "error_detail": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", sync_log_id).execute()
        raise


if __name__ == "__main__":
    result = sync_bank_transactions()
    print(result)