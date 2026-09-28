"""
cfo_tower/chat/llm_tools.py

Stage 2 of the hybrid chatbot: LLM tool-calling fallback, used only when
router.try_route() finds no deterministic match.

Hard rule (do not relax this): the LLM is ONLY ever used for two things:
  1. Deciding which tool(s) to call and with what arguments.
  2. Writing prose THAT WRAPS real values your code already substituted in --
     it never gets to free-type a number itself.

This is enforced mechanically by _assert_no_invented_numbers(), which
diffs every digit sequence in the LLM's final response against the set of
digit sequences that actually appear in the tool results it was given. Any
number in the response that didn't come from a tool result fails the check,
and the caller falls back to a plain, code-built template instead of the
LLM's prose -- the same numbers, just without the model's sentence around
them. This means a fabricated number can produce an ugly answer, but it can
never produce a *wrong* one.

WHY THIS USES MANUAL JSON INSTEAD OF llama.cpp's `tools` API PARAMETER:
The Qwen2.5-VL-7B-Instruct GGUF this project runs is the multimodal
(vision+video) build, paired with --mmproj. Checking its /props endpoint
(GET http://localhost:8080/props) shows chat_template_caps.supports_tools
is FALSE -- this specific build's bundled chat template has no tool-call
branch at all (it only handles text/image/video content types), so
llama.cpp falls back to a generic "peg-native" parser that silently
produces zero tool calls on every request, regardless of --jinja or any
other server flag. This was confirmed by inspecting the live template via
/props, not assumed.

The fix: skip llama.cpp's structured `tools`/`tool_choice` parameters
entirely. Instead, the system prompt directly instructs the model to
reply with a single JSON object naming a tool and its arguments, and this
module parses that JSON itself. This was tested directly against the
running server and reliably produces clean, parseable output (e.g.
`{"tool": "get_top_receivables", "args": {"p_limit": 5}}`). This approach
doesn't depend on chat_template_caps.supports_tools at all -- it's just
instruction-following + manual parsing, so it works with this exact model
file with no server reconfiguration. The no-invented-numbers guardrail
below is completely independent of this mechanism and applies exactly the
same either way.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Optional

import requests

from .router import fmt_inr, month_start_iso, today_iso
from .supabase_client import call_rpc, select_table

LLAMA_CPP_URL = os.environ.get("LLAMA_CPP_URL", "http://localhost:8080")

# ----------------------------------------------------------------------------
# Tool schema -- one entry per RPC/view/table the chatbot is allowed to query.
# This list is the complete, audited surface from the actual frontend code
# (grep'd across every page) -- nothing here was invented.
# ----------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_period_kpis",
            "description": "Revenue billed, collected, paid out, sales orders, credit notes for a date range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_start_date": {"type": "string", "format": "date"},
                    "p_end_date": {"type": "string", "format": "date"},
                },
                "required": ["p_start_date", "p_end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_as_on_kpis",
            "description": "Outstanding/overdue receivables and payables, net position, as of a specific date.",
            "parameters": {
                "type": "object",
                "properties": {"p_as_on_date": {"type": "string", "format": "date"}},
                "required": ["p_as_on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_receivables_ageing",
            "description": (
                "Receivables grouped into ageing buckets (Current, 1-30, 31-60, 61-90, 90+ days). "
                "Always computed as of today -- there is no date parameter."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_payables_ageing",
            "description": (
                "Payables grouped into ageing buckets. Always computed as of today -- "
                "there is no date parameter."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_receivables",
            "description": "Top customers by outstanding receivable balance, as of a date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_as_on_date": {"type": "string", "format": "date"},
                    "p_limit": {"type": "integer", "default": 20},
                },
                "required": ["p_as_on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_payables",
            "description": "Top vendors by outstanding payable balance, as of a date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_as_on_date": {"type": "string", "format": "date"},
                    "p_limit": {"type": "integer", "default": 20},
                },
                "required": ["p_as_on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_invoices_by_amount",
            "description": (
                "Individual invoices (NOT aggregated by customer) ranked by amount, "
                "within a date range. Use this for 'top N invoices' questions -- "
                "get_top_receivables is for 'top N customers' instead, which is different."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "p_start_date": {"type": "string", "format": "date"},
                    "p_end_date": {"type": "string", "format": "date"},
                    "p_limit": {"type": "integer", "default": 10},
                },
                "required": ["p_start_date", "p_end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_bills_by_amount",
            "description": (
                "Individual vendor bills (NOT aggregated by vendor) ranked by amount, "
                "within a date range. Use this for 'top N bills' questions -- "
                "get_top_payables is for 'top N vendors' instead, which is different. "
                "'Bill' here means vendor bill / payable, not customer invoice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "p_start_date": {"type": "string", "format": "date"},
                    "p_end_date": {"type": "string", "format": "date"},
                    "p_limit": {"type": "integer", "default": 10},
                },
                "required": ["p_start_date", "p_end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_period_deposits",
            "description": "Itemized bank deposits in a date range (for cash flow).",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_start_date": {"type": "string", "format": "date"},
                    "p_end_date": {"type": "string", "format": "date"},
                },
                "required": ["p_start_date", "p_end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_period_withdrawals",
            "description": "Itemized bank withdrawals in a date range (for cash flow).",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_start_date": {"type": "string", "format": "date"},
                    "p_end_date": {"type": "string", "format": "date"},
                },
                "required": ["p_start_date", "p_end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_receivable_overdue_list_net",
            "description": "Overdue receivables net of TDS, as of a date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_as_on_date": {"type": "string", "format": "date"},
                    "p_limit": {"type": "integer", "default": 50},
                },
                "required": ["p_as_on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_payable_overdue_list_net",
            "description": "Overdue payables net of TDS, as of a date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "p_as_on_date": {"type": "string", "format": "date"},
                    "p_limit": {"type": "integer", "default": 50},
                },
                "required": ["p_as_on_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_cockpit_summary",
            "description": "Single-row overall CFO cockpit summary: revenue, pipeline, outstanding, payables, exceptions, headcount, tickets.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_sync_logs",
            "description": "Recent Zoho/greytHR/etc. integration sync run history.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 20}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_data_exceptions",
            "description": "Open data exceptions/quality issues detected in synced data.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 20}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_confidence_dashboard",
            "description": "Mapping confidence scores per module (e.g. Billing, Payables).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_unassigned_invoices",
            "description": "Invoices not yet assigned to a project.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# Maps a tool name the LLM can request to the actual call. Tools prefixed
# `select_` hit a table/view directly rather than an RPC.
_TOOL_DISPATCH = {
    "get_period_kpis": lambda args: call_rpc("get_period_kpis", args),
    "get_as_on_kpis": lambda args: call_rpc("get_as_on_kpis", args),
    "select_receivables_ageing": lambda args: select_table("v_receivables_ageing"),
    "select_payables_ageing": lambda args: select_table("v_payables_ageing"),
    "get_top_receivables": lambda args: call_rpc("get_top_receivables", args),
    "get_top_payables": lambda args: call_rpc("get_top_payables", args),
    "get_top_invoices_by_amount": lambda args: call_rpc("get_top_invoices_by_amount", args),
    "get_top_bills_by_amount": lambda args: call_rpc("get_top_bills_by_amount", args),
    "get_period_deposits": lambda args: call_rpc("get_period_deposits", args),
    "get_period_withdrawals": lambda args: call_rpc("get_period_withdrawals", args),
    "get_receivable_overdue_list_net": lambda args: call_rpc("get_receivable_overdue_list_net", args),
    "get_payable_overdue_list_net": lambda args: call_rpc("get_payable_overdue_list_net", args),
    "select_cockpit_summary": lambda args: select_table("v_cfo_cockpit", limit=1),
    "select_sync_logs": lambda args: select_table(
        "sync_logs", order_by="started_at", descending=True, limit=args.get("limit", 20)
    ),
    "select_data_exceptions": lambda args: select_table(
        "data_exceptions", filters={"status": "open"}, order_by="detected_at",
        descending=True, limit=args.get("limit", 20)
    ),
    "select_confidence_dashboard": lambda args: select_table("v_confidence_dashboard"),
    "select_unassigned_invoices": lambda args: select_table("v_unassigned_invoices"),
}

def _render_tools_for_prompt() -> str:
    """Builds a compact, plain-text tool list from the TOOLS schema above,
    so the prompt-based instructions below never drift out of sync with
    the actual dispatch table -- one source of truth for what tools exist."""
    lines = []
    for tool in TOOLS:
        fn = tool["function"]
        params = fn.get("parameters", {}).get("properties", {})
        param_str = ", ".join(params.keys()) if params else ""
        lines.append(f"- {fn['name']}({param_str}): {fn['description']}")
    return "\n".join(lines)


def _render_few_shot_examples() -> str:
    """Worked question -> correct-tool-choice examples, specifically targeting
    the confusion patterns observed in real use: the model picking an
    AGGREGATE tool (totals/counts only) when the person actually wanted a
    LIST of individual records, or vice versa. Each pair below deliberately
    contrasts a 'list' phrasing against an 'aggregate' phrasing for the same
    topic, since showing the distinction side-by-side teaches it far more
    reliably than a text description alone -- this is a standard, proven
    prompting technique (few-shot examples), not a guess.

    Dates in the examples use today's real date so they stay self-consistent
    with the "resolve relative dates yourself" instruction in SYSTEM_PROMPT."""
    today = today_iso()
    month_start = month_start_iso()
    return f"""Worked examples (question -> correct choice):

Q: "give me list of invoices this month"
A: {{"tool": "get_top_invoices_by_amount", "args": {{"p_start_date": "{month_start}", "p_end_date": "{today}", "p_limit": 1000}}}}
(This asks for a LIST of individual invoices, not a total -- use the by-amount list tool, not get_period_kpis. p_limit set high since "all" was requested, not "top N".)

Q: "how much revenue did we bill this month"
A: {{"tool": "get_period_kpis", "args": {{"p_start_date": "{month_start}", "p_end_date": "{today}"}}}}
(This asks for a single aggregate figure, not a list of invoices -- use get_period_kpis.)

Q: "show me all the bills from this quarter"
A: {{"tool": "get_top_bills_by_amount", "args": {{"p_start_date": "2026-04-01", "p_end_date": "{today}", "p_limit": 1000}}}}
(A LIST of individual bills was asked for -- use the by-amount list tool, with a high p_limit since "all" was requested, not get_period_kpis which only has counts/totals.)

Q: "who are our top 3 customers by receivables"
A: {{"tool": "get_top_receivables", "args": {{"p_as_on_date": "{today}", "p_limit": 3}}}}
(Asks for customers ranked by their TOTAL outstanding -- a per-customer rollup, not individual invoices -- use get_top_receivables, not get_top_invoices_by_amount.)

Q: "what are our 5 biggest invoices this year"
A: {{"tool": "get_top_invoices_by_amount", "args": {{"p_start_date": "2026-01-01", "p_end_date": "{today}", "p_limit": 5}}}}
(Asks for individual INVOICES ranked by their own amount, not customers -- use get_top_invoices_by_amount, not get_top_receivables.)

Q: "what's our receivables ageing"
A: {{"tool": "select_receivables_ageing", "args": {{}}}}
(Asks for the ageing-bucket breakdown specifically, not the single current-position snapshot -- use select_receivables_ageing, not get_as_on_kpis.)

Q: "what's our current outstanding and overdue position"
A: {{"tool": "get_as_on_kpis", "args": {{"p_as_on_date": "{today}"}}}}
(Asks for the overall position snapshot, not a breakdown by age bucket -- use get_as_on_kpis, not select_receivables_ageing.)

Q: (after already being shown a list of invoices) "now add the customer's GSTIN"
A: {{"tool": "REUSE_PREVIOUS", "args": {{}}}}
(A follow-up refining how the SAME data is shown, not a new question -- reuse the previous tool call.)

Q: "what's the capital of France"
A: {{"tool": null, "args": {{}}}}
(Not a financial/data question this system can answer at all -- decline rather than guessing.)
"""


SYSTEM_PROMPT = (
    "You are the AI Analyst for AIS CFO Ops Control Tower, a financial operations "
    "dashboard. Given a question, you must respond with ONLY a single JSON object, "
    "no other text, no markdown code fences, no explanation before or after it. "
    "The JSON must have this exact shape:\n"
    '{"tool": "<tool_name>", "args": {<key-value pairs matching that tool\'s parameters>}}\n\n'
    "Available tools:\n"
    f"{_render_tools_for_prompt()}\n\n"
    "IMPORTANT distinction: some tools return AGGREGATE totals/counts only "
    "(get_period_kpis, get_as_on_kpis) -- use these when the person wants a "
    "single summary figure. Other tools return a LIST of individual records "
    "(get_top_invoices_by_amount, get_top_bills_by_amount, get_top_receivables, "
    "get_top_payables) -- use these when the person wants to see specific "
    "invoices/bills/customers/vendors, including for plain 'list/show/all' "
    "phrasing, not just explicit 'top N' phrasing. When in doubt and the "
    "question mentions seeing specific records rather than a single number, "
    "prefer the list-returning tool.\n\n"
    f"{_render_few_shot_examples()}\n"
    f"Today's date is {today_iso()}. All date parameters must be real ISO dates "
    "(YYYY-MM-DD), never relative words like 'today' or 'this quarter' -- resolve "
    "them to actual dates yourself before writing the JSON. For tools with no listed "
    "parameters, use an empty args object: {}. "
    "\n\nIf the conversation history shows you already fetched data for this topic and "
    "the person's new message is asking to see it differently (e.g. 'show that as a "
    "table', 'add the vendor name', 'sort by date instead') rather than asking a "
    "genuinely new question, respond with exactly: "
    '{"tool": "REUSE_PREVIOUS", "args": {}} '
    "-- the previous data will be reused, you do not need to call a tool again. "
    "If no tool genuinely fits the question and it isn't a follow-up either, respond "
    'with exactly: {"tool": null, "args": {}}'
)

ANSWER_SYSTEM_PROMPT = (
    "You are the AI Analyst for AIS CFO Ops Control Tower. You will be given a "
    "question and the JSON result of a database query that answers it. Write a "
    "direct answer using ONLY the exact numbers present in that JSON -- do not round, "
    "estimate, recompute, or invent any figure that isn't literally present in the "
    "data you were given.\n\n"
    "Formatting: if the person's question or the recent conversation asks for a table "
    "(e.g. 'in a table', 'as a table'), format your entire answer as a GitHub-flavored "
    "markdown table with a header row -- columns matching the fields present in the "
    "data. Otherwise use a short numbered or bulleted list for multi-row data, or a "
    "couple of plain sentences for single-value data. Never invent a column of data "
    "that isn't present in the JSON you were given."
)


def _digit_sequences(text: str) -> set[str]:
    """Extracts normalized digit sequences (strips commas/currency symbols/
    formatting) for comparing 'did this number actually come from the data'."""
    cleaned = re.sub(r"[,₹$%]", "", text)
    return set(re.findall(r"\d+\.?\d*", cleaned))


def _is_grounded(answer_num: str, grounded_numbers: set[float]) -> bool:
    """True if answer_num is a real numeric match (exact, or the Cr/L/K
    truncated-abbreviation of) some value actually present in the tool
    results. This is a VALUE comparison, not a string/substring comparison
    -- e.g. '47300001' must NOT match '4730000' just because one contains
    the other's digits; but '47.3' SHOULD match '4730000' because that's
    the genuine truncated-lakh abbreviation (4730000 / 100000 = 47.3)."""
    try:
        val = float(answer_num)
    except ValueError:
        return False

    for g in grounded_numbers:
        if abs(val - g) < 0.01:
            return True
        # Truncated abbreviation check: val might be g expressed in
        # Lakhs (1e5), Crores (1e7), or Thousands (1e3), rounded to 1-2
        # decimal places (matching fmt_inr's .toFixed(2) behaviour).
        for divisor in (1_00_000, 1_00_00_000, 1_000):
            if g == 0:
                continue
            scaled = g / divisor
            if abs(val - round(scaled, 2)) < 0.015 or abs(val - round(scaled, 1)) < 0.015:
                return True
    return False


def _assert_no_invented_numbers(answer_text: str, tool_results: list[Any]) -> bool:
    """Returns True if every digit sequence in answer_text is a genuine
    numeric match (or recognized Cr/L/K abbreviation) of some value present
    in the raw tool results. Returns False if the LLM appears to have typed
    a number that isn't grounded in any tool result -- the caller should
    then discard the LLM prose and fall back to a plain template.

    This is a VALUE-level check, not a substring check: '47300001' will
    correctly fail against a grounded '4730000', even though one string
    contains the other's digits."""
    answer_numbers = _digit_sequences(answer_text)
    if not answer_numbers:
        return True  # no numeric claims at all -- nothing to verify

    grounded_raw = set()
    for result in tool_results:
        result_text = json.dumps(result, default=str)
        grounded_raw |= _digit_sequences(result_text)
    grounded_numbers: set[float] = set()
    for g in grounded_raw:
        try:
            grounded_numbers.add(float(g))
        except ValueError:
            continue

    for num in answer_numbers:
        # Skip tiny integers (likely counts, list-item ordinals like "1.",
        # "2.", or small percentages/counts already obviously in context)
        # -- these aren't the kind of fabricated financial figure we're
        # guarding against, and counts are inherently low-risk.
        if len(num.replace(".", "")) <= 2:
            continue
        if _is_grounded(num, grounded_numbers):
            continue
        return False
    return True


def _extract_tool_json(raw_text: str) -> Optional[dict[str, Any]]:
    """Parses the model's tool-selection response. Tries a direct json.loads
    first (the common case, since the model reliably returns clean JSON per
    testing); falls back to extracting the first {...} block if the model
    wrapped it in markdown fences or stray prose despite instructions not
    to. Returns None if no valid {"tool": ..., "args": ...} shape is found
    -- the caller treats that exactly like "model declined to pick a tool."
    """
    raw_text = raw_text.strip()
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict) and "tool" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass

    # Fallback: pull out the first balanced-looking {...} block and try again.
    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict) and "tool" in parsed:
                return parsed
        except json.JSONDecodeError:
            pass
    return None


def _build_fallback_template(tool_calls: list[dict[str, Any]], tool_results: list[Any]) -> str:
    """Plain, code-built answer used when the LLM's prose fails the
    no-invented-numbers check. Less natural, but 100% grounded."""
    lines = ["Here's what I found:"]
    for call, result in zip(tool_calls, tool_results):
        name = call["function"]["name"]
        lines.append(f"\n[{name}]")
        if isinstance(result, list):
            for row in result[:10]:
                lines.append("  " + ", ".join(f"{k}={v}" for k, v in row.items()))
        else:
            lines.append("  " + str(result))
    return "\n".join(lines)


@dataclass
class LLMToolResult:
    answer: str
    sources: list[dict[str, Any]]
    route: str = "llm_tool_call"
    guardrail_triggered: bool = False


def ask_with_tools(
    question: str,
    conversation_history: Optional[list[dict[str, str]]] = None,
    last_sources: Optional[list[dict[str, Any]]] = None,
) -> LLMToolResult:
    """Sends the question to Qwen (via llama.cpp's OpenAI-compatible
    /v1/chat/completions endpoint on port 8080) asking it to reply with a
    single JSON object naming a tool and arguments (see module docstring
    for why this avoids llama.cpp's structured `tools` parameter).

    conversation_history: recent {role, content} turns, so the model can
    recognize follow-ups ("show that as a table", "add vendor name") for
    what they are -- a refinement of the previous turn, not a new question.

    last_sources: the previous assistant turn's `sources` (which RPC/view +
    params it used), if any. If the model recognizes the current message as
    a follow-up, it returns {"tool": "REUSE_PREVIOUS"} and we RE-EXECUTE
    that same call here to get a FRESH real result -- we never ask the
    model to recall numbers from earlier chat text, since that would
    reintroduce exactly the hallucination risk the guardrail below exists
    to prevent. Re-fetching real data is always safer than remembering it.

    Whichever tool ends up selected (new or reused), the model then composes
    a final answer, checked by _assert_no_invented_numbers before being
    trusted."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": question})

    selection_resp = requests.post(
        f"{LLAMA_CPP_URL}/v1/chat/completions",
        json={
            "model": "qwen2.5-vl-7b-instruct",
            "messages": messages,
            "temperature": 0.1,
        },
        timeout=120,
    )
    selection_resp.raise_for_status()
    raw_selection = selection_resp.json()["choices"][0]["message"]["content"] or ""
    selection = _extract_tool_json(raw_selection)

    tool_name = selection.get("tool") if selection else None

    if tool_name == "REUSE_PREVIOUS":
        if not last_sources:
            # Model thought this was a follow-up, but there's nothing to
            # follow up ON (e.g. first message in a session). Don't guess.
            return LLMToolResult(
                answer=(
                    "I don't have a previous result to refer back to in this "
                    "conversation. Could you ask the full question directly?"
                ),
                sources=[],
                guardrail_triggered=True,
            )
        # Re-execute every tool call from the last turn fresh -- never
        # reuse remembered numbers, only remembered RPC NAMES AND PARAMS.
        sources: list[dict[str, Any]] = []
        tool_results: list[Any] = []
        for src in last_sources:
            prior_tool, prior_args = src.get("rpc"), src.get("params", {})
            dispatch = _TOOL_DISPATCH.get(prior_tool)
            if dispatch is None:
                continue
            try:
                result = dispatch(prior_args)
            except Exception as exc:
                result = {"error": str(exc)}
            sources.append({"rpc": prior_tool, "params": prior_args})
            tool_results.append(result)
        if not tool_results:
            return LLMToolResult(
                answer=(
                    "I wasn't able to map that question to any of our data sources "
                    "confidently. Could you rephrase it, or ask about revenue, "
                    "receivables, payables, cash flow, or sync status specifically?"
                ),
                sources=[],
                guardrail_triggered=True,
            )
    elif not selection or not tool_name:
        # Model declined to pick a tool, or its output didn't parse at all.
        # Either way, there is nothing grounding an answer, so don't try to
        # salvage one -- ask the person to be more specific instead.
        return LLMToolResult(
            answer=(
                "I wasn't able to map that question to any of our data sources "
                "confidently. Could you rephrase it, or ask about revenue, "
                "receivables, payables, cash flow, or sync status specifically?"
            ),
            sources=[],
            guardrail_triggered=True,
        )
    else:
        args = selection.get("args") or {}
        if not isinstance(args, dict):
            args = {}

        dispatch = _TOOL_DISPATCH.get(tool_name)
        if dispatch is None:
            # Model named a tool that doesn't exist in our dispatch table --
            # treat this exactly like "no tool selected" rather than guessing.
            return LLMToolResult(
                answer=(
                    "I wasn't able to map that question to any of our data sources "
                    "confidently. Could you rephrase it, or ask about revenue, "
                    "receivables, payables, cash flow, or sync status specifically?"
                ),
                sources=[{"rpc": tool_name, "params": args, "error": "unknown tool"}],
                guardrail_triggered=True,
            )

        try:
            result = dispatch(args)
        except Exception as exc:
            result = {"error": str(exc)}

        sources = [{"rpc": tool_name, "params": args}]
        tool_results = [result]

    # Compose the final answer from whichever real result(s) we now have
    # (freshly re-fetched for a follow-up, or newly fetched for a new
    # question). Includes the recent conversation tail so the model can
    # see a request like "...in a table" that arrived in THIS message
    # while the underlying data came from a PRIOR tool call.
    answer_messages = [{"role": "system", "content": ANSWER_SYSTEM_PROMPT}]
    if conversation_history:
        answer_messages.extend(conversation_history[-2:])  # just enough for formatting hints
    answer_messages.append({
        "role": "user",
        "content": (
            f"Question: {question}\n\n"
            f"Data: {json.dumps([r for r in tool_results], default=str)}"
        ),
    })

    final_resp = requests.post(
        f"{LLAMA_CPP_URL}/v1/chat/completions",
        json={
            "model": "qwen2.5-vl-7b-instruct",
            "messages": answer_messages,
            "temperature": 0.1,
        },
        timeout=120,
    )
    final_resp.raise_for_status()
    answer_text = final_resp.json()["choices"][0]["message"]["content"] or ""

    if not _assert_no_invented_numbers(answer_text, tool_results):
        # Guardrail fired -- discard the model's prose, return the raw
        # grounded data instead. This is the case that matters most: better
        # an ungainly answer than a wrong one.
        return LLMToolResult(
            answer=_build_fallback_template(
                [{"function": {"name": s["rpc"]}} for s in sources], tool_results
            ),
            sources=sources,
            guardrail_triggered=True,
        )

    return LLMToolResult(answer=answer_text, sources=sources, guardrail_triggered=False)