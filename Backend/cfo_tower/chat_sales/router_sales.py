"""
cfo_tower/chat_sales/router_sales.py

Sales chatbot's Stage 1: deterministic pattern -> view query -> template,
mirroring cfo_tower/chat/router.py exactly, scoped to the 3 CRM views
built for the Sales tower. Kept as a fully separate module (not importing
from chat/router.py) per the instruction to keep the two chatbots
independent for now.

Same rule as the CFO router: every formatted number in every answer below
comes directly from a row value returned by Supabase. Never type a
literal figure into a template string.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Optional

from .supabase_client_sales import select_table

# NOTE: this imports a local supabase_client_sales.py (byte-identical copy
# of chat/supabase_client.py) rather than the CFO chatbot's module, so this
# package has zero import-time dependency on cfo_tower/chat/. See the copy
# instructions at the bottom of chat_routes_sales.py.


def fmt_inr(n: Optional[float]) -> str:
    """Mirrors the frontend's fmtINR() exactly, matching chat/router.py's
    version -- duplicated rather than imported, per the "keep separate"
    instruction, but must stay byte-identical in behavior."""
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


@dataclass
class RouteResult:
    answer: str
    sources: list[dict[str, Any]]
    route: str = "router"


@dataclass
class Route:
    name: str
    patterns: list[str]
    handler: Callable[[re.Match, str], RouteResult]


def _route_pipeline_summary(m: re.Match, question: str) -> RouteResult:
    rows = select_table("v_crm_pipeline_summary") or []

    open_rows = [r for r in rows if str(r.get("stage_bucket", "")).startswith("Open")]
    total_weighted = sum(r.get("total_weighted_value") or 0 for r in open_rows)
    this_q = sum(
        r.get("total_weighted_value") or 0
        for r in open_rows
        if r.get("quarter_bucket") == "This Quarter"
    )
    total_deals = sum(r.get("deal_count") or 0 for r in open_rows)

    by_bucket: dict[str, float] = {}
    for r in open_rows:
        b = r.get("stage_bucket", "Unclassified")
        by_bucket[b] = by_bucket.get(b, 0) + (r.get("total_weighted_value") or 0)

    lines = [f"- {b}: {fmt_inr(v)}" for b, v in by_bucket.items()]

    answer = (
        f"Open weighted pipeline: {fmt_inr(total_weighted)} across {total_deals} deals\n"
        f"This quarter (weighted): {fmt_inr(this_q)}\n\n"
        "By stage:\n" + "\n".join(lines)
    )
    return RouteResult(
        answer=answer,
        sources=[{"rpc": "v_crm_pipeline_summary (view)", "params": {}}],
    )


def _route_win_rate(m: re.Match, question: str) -> RouteResult:
    rows = select_table("v_crm_win_rate_by_owner") or []
    if not rows:
        answer = "No win/loss data yet."
    else:
        total_won = sum(r.get("won_count") or 0 for r in rows)
        total_lost = sum(r.get("lost_count") or 0 for r in rows)
        overall = (
            round(100 * total_won / (total_won + total_lost), 1)
            if (total_won + total_lost) > 0 else None
        )
        lines = [
            f"- {r.get('resolved_owner_name', '?')}: {r.get('won_count', 0)} won, "
            f"{r.get('lost_count', 0)} lost"
            + (f" ({r['win_rate_pct']}%)" if r.get("win_rate_pct") is not None else "")
            for r in sorted(rows, key=lambda r: r.get("won_value") or 0, reverse=True)
        ]
        overall_line = f"Overall win rate: {overall}%\n\n" if overall is not None else ""
        answer = f"{overall_line}By owner:\n" + "\n".join(lines)

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "v_crm_win_rate_by_owner (view)", "params": {}}],
    )


def _route_stalled_deals(m: re.Match, question: str) -> RouteResult:
    rows = select_table("v_crm_stall_candidates", limit=15) or []
    stale_rows = [r for r in rows if r.get("staleness") != "Active"]

    if not stale_rows:
        answer = "No stalled deals right now — everything's active."
    else:
        total_value = sum(r.get("amount") or 0 for r in stale_rows)
        lines = [
            f"- {r.get('deal_name', '?')} ({r.get('account_name', '?')}) — "
            f"{fmt_inr(r.get('amount'))}, {r.get('days_since_update', '?')} days idle, "
            f"owner {r.get('resolved_owner_name', '?')}"
            for r in stale_rows[:10]
        ]
        answer = (
            f"{len(stale_rows)} stalled deal(s), {fmt_inr(total_value)} total:\n"
            + "\n".join(lines)
        )

    return RouteResult(
        answer=answer,
        sources=[{"rpc": "v_crm_stall_candidates (view)", "params": {"limit": 15}}],
    )


ROUTES: list[Route] = [
    Route(
        name="pipeline_summary",
        patterns=[r"pipeline", r"weighted (value|pipeline)", r"open deals?"],
        handler=_route_pipeline_summary,
    ),
    Route(
        name="win_rate",
        patterns=[r"win rate", r"won.*lost", r"closed won", r"how.*(winning|losing)"],
        handler=_route_win_rate,
    ),
    Route(
        name="stalled_deals",
        patterns=[r"stall", r"stale deal", r"idle deal", r"deals?.*(stuck|not moving)", r"need.*attention"],
        handler=_route_stalled_deals,
    ),
]


def try_route(question: str) -> Optional[RouteResult]:
    for route in ROUTES:
        for pattern in route.patterns:
            m = re.search(pattern, question, re.IGNORECASE)
            if m:
                try:
                    return route.handler(m, question)
                except Exception as exc:
                    return RouteResult(
                        answer=f"I tried to look that up but hit an error: {exc}",
                        sources=[],
                        route="router",
                    )
    return None
