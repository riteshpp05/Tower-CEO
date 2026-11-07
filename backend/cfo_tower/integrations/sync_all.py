"""
Master sync — runs every Zoho Books sync module in the correct order.

USAGE (manual):
    cd backend
    python -m cfo_tower.integrations.sync_all

USAGE (scheduled, via Windows Task Scheduler):
    See scripts/Start-CFO-Sync.bat in backend.
"""

import sys
import logging
from datetime import datetime, timezone

from .zoho_taxes import sync_taxes
from .zoho_contacts import sync_contacts
from .zoho_currencies import sync_currencies
from .zoho_bank_transactions import sync_bank_transactions
from .zoho_invoices import sync_invoices
from .zoho_vendor_bills import sync_vendor_bills
from .zoho_sales_orders import sync_sales_orders
from .zoho_purchase_orders import sync_purchase_orders
from .zoho_customer_payments import sync_customer_payments
from .zoho_vendor_payments import sync_vendor_payments
from .zoho_credit_notes import sync_credit_notes
from .zoho_vendor_credits import sync_vendor_credits
from .zoho_expenses import sync_expenses
from .zoho_crm_opportunities import sync_crm_opportunities
from .zoho_crm_tasks import sync_crm_tasks
from .zoho_crm_notes import sync_crm_notes
from .zoho_crm_events import sync_crm_events
from .zoho_crm_calls import sync_crm_calls

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("sync_all")

SYNC_STEPS = [
    ("Taxes",              sync_taxes),
    ("Contacts",           sync_contacts),
    ("Currencies",         sync_currencies),
    ("Bank Transactions",  sync_bank_transactions),
    ("Invoices",           sync_invoices),
    ("Vendor Bills",       sync_vendor_bills),
    ("Sales Orders",       sync_sales_orders),
    ("Purchase Orders",    sync_purchase_orders),
    ("Customer Payments",  sync_customer_payments),
    ("Vendor Payments",    sync_vendor_payments),
    ("Credit Notes",       sync_credit_notes),
    ("Vendor Credits",     sync_vendor_credits),
    ("Expenses",           sync_expenses),
    ("CRM Opportunities",  sync_crm_opportunities),
    ("CRM Tasks",           sync_crm_tasks),
    ("CRM Notes",           sync_crm_notes),
    ("CRM Events",          sync_crm_events),
    ("CRM Calls",           sync_crm_calls),
]


def run_all_syncs() -> dict:
    started_at = datetime.now(timezone.utc)
    results = {}
    failures = []

    logger.info(f"=== Starting full sync — {len(SYNC_STEPS)} steps ===")

    for name, fn in SYNC_STEPS:
        logger.info(f"--- {name} ---")
        try:
            result = fn()
            results[name] = {"status": "success", "detail": result}
            logger.info(f"{name}: OK")
        except Exception as e:
            logger.error(f"{name} FAILED: {e}")
            results[name] = {"status": "failed", "error": str(e)}
            failures.append(name)
            # Continue to next sync even if one fails.

    duration = (datetime.now(timezone.utc) - started_at).total_seconds()
    summary = {
        "started_at": started_at.isoformat(),
        "duration_seconds": round(duration, 1),
        "steps_total": len(SYNC_STEPS),
        "steps_failed": len(failures),
        "failed_steps": failures,
        "results": results,
    }

    logger.info(f"=== Full sync complete in {duration:.1f}s — {len(failures)} failures ===")
    if failures:
        logger.warning(f"Failed steps: {', '.join(failures)}")

    return summary


if __name__ == "__main__":
    summary = run_all_syncs()
    print(f"\nDone in {summary['duration_seconds']}s. "
          f"{summary['steps_total'] - summary['steps_failed']}/{summary['steps_total']} succeeded.")
    if summary["steps_failed"]:
        print(f"Failed: {summary['failed_steps']}")
        sys.exit(1)