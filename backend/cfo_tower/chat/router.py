"""
cfo_tower/chat/router.py

Stage 1 of the hybrid chatbot: deterministic pattern -> RPC routing.

Every entry in ROUTES is checked against the incoming question. The FIRST
pattern that matches wins. If a route matches, its RPC(s) are called with
the extracted/default params and the answer is built entirely from a
template string substituting in the real returned values -- the LLM is
never invoked for these. This is the zero-hallucination path and should
cover the large majority of real usage.

If nothing matches, chat_service.py falls back to LLM tool-calling
(see llm_tools.py).

IMPORTANT: every formatted number in every TEMPLATE function below comes
directly from a `row[...]` value returned by Supabase. Never type a literal
rupee figure into a template string. If you're adding a new route, the
template function's job is ONLY to arrange real values into prose.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable, Optional

from .supabase_client import call_rpc, select_table


def fmt_inr(n: Optional[float]) -> str:
    """Mirrors the frontend's fmtINR() formatting exactly, for consistency
    between what the dashboards show and what the chatbot says."""
    if n is None:
        return "₹0"
    n = float(n)
    sign = "-" if n < 0 else ""
    abs_n = abs(n)
    if abs_n >= 1_00_00_000:
        return f"{sign}₹{abs_n / 1_00_00_000:.2f}Cr"
    if abs_n >= 1_00_000:
        return f"{sign}₹{abs_n / 1_00_000:.2f}L"
    return f"{sign}₹{abs_n:,.0f}"


def today_iso() -> str:
    return date.today().isoformat()


def month_start_iso() -> str:
    today = date.today()
    return today.replace(day=1).isoformat()


def week_range(anchor: date) -> tuple[str, str]:
    end = anchor + timedelta(days=6)
    return anchor.isoformat(), end.isoformat()


@dataclass
class RouteResult:
    answer: str
    sources: list[dict[str, Any]]
    route: str = "router"


@dataclass
class Route:
    name: str
    # Patterns are matched with re.search, case-insensitive, against the
    # raw question text. Any one matching is sufficient.
    patterns: list[str]
    handler: Callable[[re.Match], RouteResult]


def _match_customer_or_vendor(question: str) -> Optional[str]:
    """Very light entity extraction: look for a quoted or capitalized name
    after words like 'from'/'for'/'owed by'. This is intentionally simple --
    if it can't confidently extract a name, the route should fall through
    to the LLM tool-calling stage rather than guess."""
    m = re.search(
        r"(?:from|for|owed by|owes us|owe)\s+([A-Z][A-Za-z0-9&.\- ]{2,40})",
        question,
    )
    if m:
        return m.group(1).strip().rstrip("?.,!")
    return None


# ----------------------------------------------------------------------------
# Route handlers
# ----------------------------------------------------------------------------

def _resolve_period(question: str) -> tuple[str, str]:
    """Shared date-range resolution for phrasings like 'this month',
    'last month', 'this quarter', 'last quarter'. Defaults to month-to-date
    if nothing matches, since that's the most common implicit timeframe."""
    q = question.lower()
    today = date.today()

    if "quarter" in q:
        current_q_start_month = ((today.month - 1) // 3) * 3 + 1
        this_q_start = today.replace(month=current_q_start_month, day=1)
        if "last quarter" in q:
            last_q_end = this_q_start - timedelta(days=1)
            last_q_start_month = ((last_q_end.month - 1) // 3) * 3 + 1
            last_q_start = last_q_end.replace(month=last_q_start_month, day=1)
            return last_q_start.isoformat(), last_q_end.isoformat()
        return this_q_start.isoformat(), today.isoformat()

    if "last month" in q:
        first_this_month = today.replace(day=1)
        last_month_end = first_this_month - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return last_month_start.isoformat(), last_month_end.isoformat()

    if "this year" in q or "year to date" in q or "ytd" in q:
        return today.replace(month=1, day=1).isoformat(), today.isoformat()

    # Default: month-to-date (covers explicit "this month" and the
    # no-timeframe-mentioned case, e.g. plain "revenue billed").
    return month_start_iso(), today_iso()


def _route_period_kpis(m: re.Match, question: str) -> RouteResult:
    start, end = _resolve_period(question)

    rows = call_rpc("get_period_kpis", {"p_start_date": start, "p_end_date": end})
    row = (rows or [{}])[0]

    answer = (
        f"For the period {start} to {end}:\n"
        f"- Revenue billed: {fmt_inr(row.get('revenue_billed'))} "
        f"({row.get('invoice_count', 0)} invoices)\n"
        f"- Collected: {fmt_inr(row.get('total_collected'))} "
        f"({row.get('payment_count', 0)} payments)\n"
        f"- Paid out: {fmt_inr(row.get('total_paid_out'))}\n"
        f"- Sales orders raised: {fmt_inr(row.get('sales_orders_raised'))}"
    )
    return RouteResult(
        answer=answer,
        sources=[{"rpc": "get_period_kpis", "params": {"p_start_date": start, "p_end_date": end}}],
    )


_WORD_TO_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def _extract_top_n(question: str, default: int = 10) -> int:
    """Shared 'top N' extraction (e.g. 'top 5', 'top five') used by every
    top_invoices/top_bills-style route, so this logic lives in one place."""
    q = question.lower()
    num_match = re.search(r"\btop\s+(\d+)\b", q)
    if num_match:
        return int(num_match.group(1))
    for word, num in _WORD_TO_NUM.items():
        if f"top {word}" in q:
            return num
    return default


def _route_top_invoices(m: re.Match, question: str) -> RouteResult:
    start, end = _resolve_period(question)
    limit = _extract_top_n(question)

    rows = call_rpc(
        "get_top_invoices_by_amount",
        {"p_start_date": start, "p_end_date": end, "p_limit": limit},
    ) or []

    if not rows:
        answer = f"No invoices found between {start} and {end}."
    else:
        lines = [
            f"{i+1}. {r['invoice_number']} — {r['customer_name']} — "
            f"{fmt_inr(r['total'])} ({r['invoice_date']})"
            for i, r in enumerate(rows)
        ]
        answer = f"Top {len(rows)} invoice(s) by amount, {start} to {end}:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{
            "rpc": "get_top_invoices_by_amount",
            "params": {"p_start_date": start, "p_end_date": end, "p_limit": limit},
        }],
    )


def _route_top_bills(m: re.Match, question: str) -> RouteResult:
    start, end = _resolve_period(question)
    limit = _extract_top_n(question)

    rows = call_rpc(
        "get_top_bills_by_amount",
        {"p_start_date": start, "p_end_date": end, "p_limit": limit},
    ) or []

    if not rows:
        answer = f"No vendor bills found between {start} and {end}."
    else:
        lines = [
            f"{i+1}. {r['bill_number']} — {r['vendor_name']} — "
            f"{fmt_inr(r['total'])} ({r['bill_date']})"
            for i, r in enumerate(rows)
        ]
        answer = f"Top {len(rows)} bill(s) by amount, {start} to {end}:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{
            "rpc": "get_top_bills_by_amount",
            "params": {"p_start_date": start, "p_end_date": end, "p_limit": limit},
        }],
    )


def _route_as_on_kpis(m: re.Match, question: str) -> RouteResult:
    as_on = today_iso()
    rows = call_rpc("get_as_on_kpis", {"p_as_on_date": as_on})
    row = (rows or [{}])[0]

    answer = (
        f"As of {as_on}:\n"
        f"- Outstanding receivables: {fmt_inr(row.get('total_outstanding'))} "
        f"({row.get('open_invoice_count', 0)} open invoices)\n"
        f"- Overdue receivables: {fmt_inr(row.get('total_overdue'))} "
        f"({row.get('overdue_invoice_count', 0)} overdue)\n"
        f"- Outstanding payables: {fmt_inr(row.get('total_payables'))} "
        f"({row.get('open_bill_count', 0)} open bills)\n"
        f"- Overdue payables: {fmt_inr(row.get('total_payables_overdue'))} "
        f"({row.get('overdue_bill_count', 0)} overdue)\n"
        f"- Net position: {fmt_inr(row.get('net_position'))}"
    )
    return RouteResult(
        answer=answer,
        sources=[{"rpc": "get_as_on_kpis", "params": {"p_as_on_date": as_on}}],
    )


def _route_top_receivables(m: re.Match, question: str) -> RouteResult:
    as_on = today_iso()
    limit = 5
    rows = call_rpc("get_top_receivables", {"p_as_on_date": as_on, "p_limit": limit}) or []

    if not rows:
        answer = f"No outstanding receivables as of {as_on}."
    else:
        lines = [
            f"{i+1}. {r['customer_name']} — {fmt_inr(r['total_outstanding'])} "
            f"outstanding ({fmt_inr(r['total_overdue'])} overdue, {r['invoice_count']} invoices)"
            for i, r in enumerate(rows)
        ]
        answer = f"Top receivables as of {as_on}:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "get_top_receivables", "params": {"p_as_on_date": as_on, "p_limit": limit}}],
    )


def _route_top_payables(m: re.Match, question: str) -> RouteResult:
    as_on = today_iso()
    limit = 5
    rows = call_rpc("get_top_payables", {"p_as_on_date": as_on, "p_limit": limit}) or []

    if not rows:
        answer = f"No outstanding payables as of {as_on}."
    else:
        lines = [
            f"{i+1}. {r['vendor_name']} — {fmt_inr(r['total_outstanding'])} "
            f"outstanding ({fmt_inr(r['total_overdue'])} overdue, {r['bill_count']} bills)"
            for i, r in enumerate(rows)
        ]
        answer = f"Top payables as of {as_on}:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "get_top_payables", "params": {"p_as_on_date": as_on, "p_limit": limit}}],
    )


def _route_ageing(m: re.Match, question: str) -> RouteResult:
    # IMPORTANT: v_receivables_ageing / v_payables_ageing (migration 018) are
    # plain VIEWS, not parameterized functions -- they're always computed
    # as of current_date inside the view definition itself. There is no
    # get_receivables_ageing()/get_payables_ageing() RPC in the confirmed
    # schema (001-019). An earlier version of this handler called RPCs by
    # those names, which would have failed on every call rather than
    # silently returning wrong data -- still a bug, just a loud one. If a
    # later migration (020+) DOES add parameterized versions of these,
    # swap select_table(...) below for call_rpc(...) with p_as_on_date.
    is_payables = "payable" in question.lower()
    view_name = "v_payables_ageing" if is_payables else "v_receivables_ageing"
    rows = select_table(view_name) or []

    label = "payables" if is_payables else "receivables"
    as_on = today_iso()
    if not rows:
        answer = f"No {label} ageing data as of {as_on}."
    else:
        count_key = "bill_count" if is_payables else "invoice_count"
        lines = [
            f"- {r['ageing_bucket']}: {fmt_inr(r['total_balance'])} ({r.get(count_key, 0)})"
            for r in rows
        ]
        answer = f"{label.capitalize()} ageing as of {as_on} (current snapshot):\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": f"{view_name} (view)", "params": {}}],
    )


def _route_cockpit(m: re.Match, question: str) -> RouteResult:
    rows = select_table("v_cfo_cockpit", limit=1)
    row = (rows or [{}])[0]

    answer = (
        "Current cockpit summary:\n"
        f"- Revenue billed (MTD): {fmt_inr(row.get('revenue_billed_mtd'))}\n"
        f"- Weighted pipeline: {fmt_inr(row.get('weighted_pipeline'))}\n"
        f"- Total outstanding: {fmt_inr(row.get('total_outstanding'))}\n"
        f"- Overdue: {fmt_inr(row.get('total_overdue'))}\n"
        f"- Vendor payables: {fmt_inr(row.get('total_payables'))}\n"
        f"- Critical exceptions: {row.get('critical_exceptions', 0)}\n"
        f"- Overdue actions: {row.get('overdue_actions', 0)}\n"
        f"- Billable headcount: {row.get('billable_headcount', 0)} "
        f"(bench: {row.get('bench_headcount', 0)})\n"
        f"- Open tickets: {row.get('open_tickets', 0)}"
    )
    return RouteResult(
        answer=answer,
        sources=[{"rpc": "v_cfo_cockpit (view)", "params": {}}],
    )


def _route_cash_flow_this_week(m: re.Match, question: str) -> RouteResult:
    start, end = week_range(date.today())
    dep_rows = call_rpc("get_period_deposits", {"p_start_date": start, "p_end_date": end}) or []
    wit_rows = call_rpc("get_period_withdrawals", {"p_start_date": start, "p_end_date": end}) or []

    total_dep = sum(r["amount"] for r in dep_rows)
    total_wit = sum(r["amount"] for r in wit_rows)

    opening_rows = select_table(
        "cash_flow_manual_entries",
        filters={"period_start": start, "period_end": end},
        limit=1,
    )
    opening = (opening_rows or [{}])[0].get("opening_balance")
    closing = (opening or 0) + total_dep - total_wit

    answer = (
        f"Cash flow for the week {start} to {end}:\n"
        f"- Opening balance: {fmt_inr(opening)}\n"
        f"- Total deposits: {fmt_inr(total_dep)} ({len(dep_rows)} transactions)\n"
        f"- Total withdrawals: {fmt_inr(total_wit)} ({len(wit_rows)} transactions)\n"
        f"- Closing balance: {fmt_inr(closing)}"
    )
    return RouteResult(
        answer=answer,
        sources=[
            {"rpc": "get_period_deposits", "params": {"p_start_date": start, "p_end_date": end}},
            {"rpc": "get_period_withdrawals", "params": {"p_start_date": start, "p_end_date": end}},
            {"rpc": "cash_flow_manual_entries (table)", "params": {"period_start": start, "period_end": end}},
        ],
    )


def _route_overdue_net_tds(m: re.Match, question: str) -> RouteResult:
    as_on = today_iso()
    is_payables = "payable" in question.lower() or "vendor" in question.lower()
    rpc_name = "get_payable_overdue_list_net" if is_payables else "get_receivable_overdue_list_net"
    rows = call_rpc(rpc_name, {"p_as_on_date": as_on, "p_limit": 10}) or []

    label = "payables" if is_payables else "receivables"
    name_key = "vendor_name" if is_payables else "customer_name"

    if not rows:
        answer = f"No overdue {label} (net of TDS) as of {as_on}."
    else:
        total_net = sum(r["net_amount"] for r in rows)
        total_gross = sum(r["gross_amount"] for r in rows)
        lines = [f"- {r[name_key]}: {fmt_inr(r['net_amount'])} net" for r in rows[:10]]
        answer = (
            f"Overdue {label}, net of TDS, as of {as_on} "
            f"(gross {fmt_inr(total_gross)}, net {fmt_inr(total_net)}):\n" + "\n".join(lines)
        )

    return RouteResult(
        answer=answer,
        sources=[{"rpc": rpc_name, "params": {"p_as_on_date": as_on, "p_limit": 10}}],
    )


def _route_zoho_sync_status(m: re.Match, question: str) -> RouteResult:
    rows = select_table("sync_logs", order_by="started_at", descending=True, limit=15)
    if not rows:
        answer = "No sync runs recorded yet."
    else:
        by_source: dict[str, dict] = {}
        for r in rows:
            src = r["source"]
            if src not in by_source:
                by_source[src] = r
        lines = [
            f"- {src}: {r['status']} ({r.get('records_inserted', 0)} inserted, "
            f"{r.get('records_failed', 0)} failed) at {r['started_at']}"
            for src, r in by_source.items()
        ]
        answer = "Latest sync status by source:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "sync_logs (table)", "params": {"order_by": "started_at desc", "limit": 15}}],
    )


def _route_confidence_scores(m: re.Match, question: str) -> RouteResult:
    rows = select_table("v_confidence_dashboard", limit=10)
    if not rows:
        answer = "No confidence score data available."
    else:
        # v_confidence_dashboard's real columns are `module` and `score`
        # (see migration 016) -- there is no `module_name` or
        # `confidence_score` column. Using those wrong keys previously
        # caused every line to silently render as "? : ?%" instead of
        # erroring, which is the worst kind of bug for a tool whose whole
        # point is never showing an ungrounded number.
        lines = [
            f"- {r.get('module', '?')}: {r.get('score', '?')}% ({r.get('confidence_label', '')})"
            for r in rows
        ]
        answer = "Confidence scores:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "v_confidence_dashboard (view)", "params": {}}],
    )


def _route_exceptions(m: re.Match, question: str) -> RouteResult:
    rows = select_table(
        "data_exceptions",
        filters={"status": "open"},
        order_by="detected_at",
        descending=True,
        limit=10,
    )
    if not rows:
        answer = "No open data exceptions right now."
    else:
        # data_exceptions' real columns are `message`, `severity`,
        # `detected_at` (see migration 003) -- there is no `description`,
        # `title`, or `created_at`. The previous version's order_by on a
        # non-existent column would have raised a Postgres error on every
        # call rather than silently returning wrong data, which is at
        # least loud -- but still worth fixing rather than relying on the
        # except-and-apologize fallback in try_route().
        lines = [f"- [{r.get('severity', '?')}] {r.get('message', 'No message')}" for r in rows]
        answer = f"{len(rows)} open data exception(s):\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "data_exceptions (table)", "params": {"status": "open", "limit": 10}}],
    )


def _route_unassigned_invoices(m: re.Match, question: str) -> RouteResult:
    rows = select_table("v_unassigned_invoices", limit=200)
    if not rows:
        answer = "No unassigned invoices — every invoice has a project."
    else:
        # v_unassigned_invoices' amount column is `total` (see migration 014),
        # not `amount` -- using the wrong key here would silently sum to 0
        # for every row instead of erroring, which is worse than a crash.
        total = sum(r.get("total", 0) or 0 for r in rows)
        answer = f"{len(rows)} unassigned invoice(s), totaling {fmt_inr(total)}."

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "v_unassigned_invoices (view)", "params": {"limit": 200}}],
    )


# ----------------------------------------------------------------------------
# Route table — order matters; first match wins
# ----------------------------------------------------------------------------

ROUTES: list[Route] = [
    Route(
        name="cockpit_summary",
        patterns=[r"\bcockpit\b", r"how are we doing overall", r"overall (position|summary|status)"],
        handler=_route_cockpit,
    ),
    Route(
        name="top_receivables",
        patterns=[r"top receivables", r"who owes us", r"biggest (receivable|debtor)", r"who.*owes.*most"],
        handler=_route_top_receivables,
    ),
    Route(
        name="top_payables",
        patterns=[r"top payables", r"who do we owe", r"biggest (payable|vendor)", r"largest vendor"],
        handler=_route_top_payables,
    ),
    Route(
        name="receivables_ageing",
        patterns=[r"receivable.*ageing", r"ageing.*receivable", r"aging.*receivable"],
        handler=_route_ageing,
    ),
    Route(
        name="payables_ageing",
        patterns=[r"payable.*ageing", r"ageing.*payable", r"aging.*payable"],
        handler=_route_ageing,
    ),
    Route(
        name="overdue_net_tds",
        patterns=[r"overdue.*net of tds", r"net of tds", r"tds.*overdue"],
        handler=_route_overdue_net_tds,
    ),
    Route(
        name="as_on_position",
        patterns=[
            r"outstanding (receivable|payable)", r"overdue (receivable|payable)",
            r"net position", r"current (receivable|payable) position",
        ],
        handler=_route_as_on_kpis,
    ),
    Route(
        name="top_invoices",
        patterns=[
            r"top.*invoice", r"biggest invoice", r"largest invoice",
            r"highest.*invoice",
        ],
        handler=_route_top_invoices,
    ),
    Route(
        name="top_bills",
        patterns=[
            r"top.*\bbills?\b", r"biggest\s+bill", r"largest\s+bill",
            r"highest.*\bbill\b",
        ],
        handler=_route_top_bills,
    ),
    Route(
        name="period_kpis",
        patterns=[
            r"revenue.*\b(bill|billed)\b", r"how much.*\b(bill|collect)",
            r"period (kpi|summary)", r"this month.*(revenue|collection)",
            r"(revenue|collections?)\b.*\b(this|last)\s+(month|quarter|year)",
        ],
        handler=_route_period_kpis,
    ),
    Route(
        name="cash_flow_week",
        patterns=[r"cash flow", r"closing balance", r"opening balance", r"deposits and withdrawals"],
        handler=_route_cash_flow_this_week,
    ),
    Route(
        name="zoho_sync_status",
        patterns=[r"sync status", r"last sync", r"is zoho synced", r"sync.*health"],
        handler=_route_zoho_sync_status,
    ),
    Route(
        name="confidence_scores",
        patterns=[r"confidence score", r"data confidence", r"mapping confidence"],
        handler=_route_confidence_scores,
    ),
    Route(
        name="exceptions",
        patterns=[r"data exception", r"open exceptions?", r"what.*exceptions"],
        handler=_route_exceptions,
    ),
    Route(
        name="unassigned_invoices",
        patterns=[r"unassigned invoice", r"invoices? without a project", r"unmapped invoice"],
        handler=_route_unassigned_invoices,
    ),
]


def try_route(question: str) -> Optional[RouteResult]:
    """Returns a RouteResult if a deterministic pattern matched, else None
    (caller should fall back to LLM tool-calling)."""
    for route in ROUTES:
        for pattern in route.patterns:
            m = re.search(pattern, question, re.IGNORECASE)
            if m:
                try:
                    return route.handler(m, question)
                except Exception as exc:
                    # A matched route that fails to execute should surface a
                    # clear, honest error -- not silently fall through and
                    # risk the LLM fallback guessing at the same question.
                    return RouteResult(
                        answer=f"I tried to look that up but hit an error: {exc}",
                        sources=[],
                        route="router",
                    )
    return None