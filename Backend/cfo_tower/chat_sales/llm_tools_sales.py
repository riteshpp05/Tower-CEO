"""
cfo_tower/chat_sales/llm_tools_sales.py

Sales chatbot's Stage 2: LLM tool-calling fallback, used only when
router_sales.try_route() finds no deterministic match. Mirrors
cfo_tower/chat/llm_tools.py's architecture exactly -- same manual-JSON
tool-calling approach (Qwen2.5-VL's bundled template has
chat_template_caps.supports_tools == False, confirmed via /props on the
live server), same no-invented-numbers guardrail. Kept as a fully
separate module rather than importing from chat/llm_tools.py, per the
instruction to keep the two chatbots independent for now -- the guardrail
functions below are byte-identical in logic to their CFO counterparts.

Tool surface is intentionally narrow: only the 3 CRM views built for the
Sales tower. This chatbot has no path to financial RPCs at all -- not
just hidden by prompt instructions, but literally absent from TOOLS and
_TOOL_DISPATCH, so there's nothing for the model to even attempt to call.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Optional

import requests

from .router_sales import fmt_inr
from .supabase_client_sales import select_table

LLAMA_CPP_URL = os.environ.get("LLAMA_CPP_URL", "http://localhost:8080")


def today_iso() -> str:
    from datetime import date
    return date.today().isoformat()


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "select_pipeline_summary",
            "description": (
                "Weighted CRM pipeline broken down by stage bucket (Open - Early/Mid/Late, "
                "Won, Lost) and quarter (Past Due, This Quarter, Next Quarter, Beyond). "
                "Use for questions about pipeline value, deal counts, or forecasted-quarter pipeline."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_win_rate_by_owner",
            "description": (
                "Won/lost deal counts, win rate percentage, and won value, broken down by "
                "sales owner. Use for questions about who is winning/losing deals, or "
                "overall/per-person win rate."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_stalled_deals",
            "description": (
                "Open deals not yet closed, flagged by days since last update (30/60/90+ day "
                "staleness buckets). This is a proxy for deal velocity -- Zoho CRM doesn't "
                "expose true per-stage duration, only time-since-last-update. Use for "
                "questions about stalled, stuck, idle, or neglected deals."
            ),
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 15}},
            },
        },
    },
]

_TOOL_DISPATCH = {
    "select_pipeline_summary": lambda args: select_table("v_crm_pipeline_summary"),
    "select_win_rate_by_owner": lambda args: select_table("v_crm_win_rate_by_owner"),
    "select_stalled_deals": lambda args: select_table(
        "v_crm_stall_candidates", limit=args.get("limit", 15)
    ),
}


def _render_tools_for_prompt() -> str:
    lines = []
    for tool in TOOLS:
        fn = tool["function"]
        params = fn.get("parameters", {}).get("properties", {})
        param_str = ", ".join(params.keys()) if params else ""
        lines.append(f"- {fn['name']}({param_str}): {fn['description']}")
    return "\n".join(lines)


def _render_few_shot_examples() -> str:
    return """Worked examples (question -> correct choice):

Q: "what's my weighted pipeline this quarter"
A: {"tool": "select_pipeline_summary", "args": {}}
(Asks about pipeline value -- use select_pipeline_summary. It returns all stages/quarters; the answer step will pick out the "This Quarter" figures.)

Q: "who's winning the most deals"
A: {"tool": "select_win_rate_by_owner", "args": {}}
(Asks about win performance by person -- use select_win_rate_by_owner.)

Q: "any deals going stale"
A: {"tool": "select_stalled_deals", "args": {"limit": 15}}
(Asks about neglected/idle deals -- use select_stalled_deals.)

Q: (after already being shown stalled deals) "just show me the top 5"
A: {"tool": "REUSE_PREVIOUS", "args": {}}
(A follow-up refining how the SAME data is shown, not a new question -- reuse the previous tool call.)

Q: "what's our cash flow this week"
A: {"tool": null, "args": {}}
(This is financial data, not CRM/sales data -- this chatbot has no access to that. Decline rather than guessing.)

Q: "what's the capital of France"
A: {"tool": null, "args": {}}
(Not a sales/CRM question this system can answer at all -- decline rather than guessing.)
"""


SYSTEM_PROMPT = (
    "You are the Sales Analyst for AIS Sales Pipeline Tower, scoped ONLY to CRM/pipeline "
    "data -- you have NO access to financial data (revenue, invoices, cash flow, payables). "
    "If asked about financial data, decline; that lives in a separate system. Given a "
    "question, you must respond with ONLY a single JSON object, no other text, no markdown "
    "code fences, no explanation before or after it. The JSON must have this exact shape:\n"
    '{"tool": "<tool_name>", "args": {<key-value pairs matching that tool\'s parameters>}}\n\n'
    "Available tools:\n"
    f"{_render_tools_for_prompt()}\n\n"
    f"{_render_few_shot_examples()}\n"
    f"Today's date is {today_iso()}. For tools with no listed parameters, use an empty args "
    "object: {}. "
    "\n\nIf the conversation history shows you already fetched data for this topic and the "
    "person's new message is asking to see it differently rather than asking a genuinely new "
    "question, respond with exactly: "
    '{"tool": "REUSE_PREVIOUS", "args": {}} '
    "-- the previous data will be reused, you do not need to call a tool again. If no tool "
    'genuinely fits the question and it isn\'t a follow-up either, respond with exactly: '
    '{"tool": null, "args": {}}'
)

ANSWER_SYSTEM_PROMPT = (
    "You are the Sales Analyst for AIS Sales Pipeline Tower. You will be given a question "
    "and the JSON result of a database query that answers it. Write a direct answer using "
    "ONLY the exact numbers present in that JSON -- do not round, estimate, recompute, or "
    "invent any figure that isn't literally present in the data you were given.\n\n"
    "Formatting: if the person's question or the recent conversation asks for a table, "
    "format your entire answer as a GitHub-flavored markdown table with a header row. "
    "Otherwise use a short numbered or bulleted list for multi-row data, or a couple of "
    "plain sentences for single-value data. Never invent a column of data that isn't "
    "present in the JSON you were given."
)


# ----------------------------------------------------------------------------
# No-invented-numbers guardrail -- byte-identical logic to chat/llm_tools.py.
# Duplicated rather than imported per the "keep separate" instruction.
# ----------------------------------------------------------------------------

def _digit_sequences(text: str) -> set[str]:
    cleaned = re.sub(r"[,₹$%]", "", text)
    return set(re.findall(r"\d+\.?\d*", cleaned))


def _is_grounded(answer_num: str, grounded_numbers: set[float]) -> bool:
    try:
        val = float(answer_num)
    except ValueError:
        return False

    for g in grounded_numbers:
        if abs(val - g) < 0.01:
            return True
        for divisor in (1_00_000, 1_00_00_000, 1_000):
            if g == 0:
                continue
            scaled = g / divisor
            if abs(val - round(scaled, 2)) < 0.015 or abs(val - round(scaled, 1)) < 0.015:
                return True
    return False


def _assert_no_invented_numbers(answer_text: str, tool_results: list[Any]) -> bool:
    answer_numbers = _digit_sequences(answer_text)
    if not answer_numbers:
        return True

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
        if len(num.replace(".", "")) <= 2:
            continue
        if _is_grounded(num, grounded_numbers):
            continue
        return False
    return True


def _extract_tool_json(raw_text: str) -> Optional[dict[str, Any]]:
    raw_text = raw_text.strip()
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict) and "tool" in parsed:
            return parsed
    except json.JSONDecodeError:
        pass

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

    NOT_UNDERSTOOD = (
        "I wasn't able to map that question to pipeline, win rate, or stalled-deal data. "
        "Could you rephrase it, or ask about pipeline value, win rate, or stalled deals "
        "specifically? (Financial questions aren't something I can answer here.)"
    )

    if tool_name == "REUSE_PREVIOUS":
        if not last_sources:
            return LLMToolResult(
                answer=(
                    "I don't have a previous result to refer back to in this "
                    "conversation. Could you ask the full question directly?"
                ),
                sources=[],
                guardrail_triggered=True,
            )
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
            return LLMToolResult(answer=NOT_UNDERSTOOD, sources=[], guardrail_triggered=True)
    elif not selection or not tool_name:
        return LLMToolResult(answer=NOT_UNDERSTOOD, sources=[], guardrail_triggered=True)
    else:
        args = selection.get("args") or {}
        if not isinstance(args, dict):
            args = {}

        dispatch = _TOOL_DISPATCH.get(tool_name)
        if dispatch is None:
            return LLMToolResult(
                answer=NOT_UNDERSTOOD,
                sources=[{"rpc": tool_name, "params": args, "error": "unknown tool"}],
                guardrail_triggered=True,
            )

        try:
            result = dispatch(args)
        except Exception as exc:
            result = {"error": str(exc)}

        sources = [{"rpc": tool_name, "params": args}]
        tool_results = [result]

    answer_messages = [{"role": "system", "content": ANSWER_SYSTEM_PROMPT}]
    if conversation_history:
        answer_messages.extend(conversation_history[-2:])
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
        return LLMToolResult(
            answer=_build_fallback_template(
                [{"function": {"name": s["rpc"]}} for s in sources], tool_results
            ),
            sources=sources,
            guardrail_triggered=True,
        )

    return LLMToolResult(answer=answer_text, sources=sources, guardrail_triggered=False)
