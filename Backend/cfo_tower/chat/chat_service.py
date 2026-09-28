"""
cfo_tower/chat/chat_service.py

Orchestrates a single chat turn:
  1. Try the deterministic router (router.try_route).
  2. If no match, fall back to LLM tool-calling (llm_tools.ask_with_tools),
     now passing recent conversation history AND the last turn's raw tool
     result -- see _load_recent_context() and the note in handle_turn()
     below for why the raw result matters, not just the text history.
  3. Persist both the user message and the assistant's answer to
     chat_messages, and bump chat_sessions.updated_at.

EXPLICIT OWNERSHIP CHECK (per project principle: "service role key bypasses
RLS -- always add explicit Python-layer ownership checks"): this module
uses the service role key for all of the *business data* RPCs (revenue,
receivables, etc.) because those need to be readable regardless of the
asking user's own row-level grants. But before writing or reading
chat_sessions/chat_messages on a user's behalf, we explicitly re-check
ownership in Python -- we do not rely on Postgres RLS alone, because the
service role key bypasses it entirely.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .llm_tools import ask_with_tools
from .router import try_route
from .supabase_client import call_rpc, insert_row, select_table, SupabaseCallError

PRIVILEGED_ROLES = {"md", "cfo", "admin"}


@dataclass
class ChatTurnResult:
    session_id: str
    user_message_id: str
    assistant_message_id: str
    answer: str
    sources: list[dict[str, Any]]
    route: str


class PermissionError_(Exception):
    pass


def _get_session_owner(session_id: str) -> Optional[str]:
    rows = select_table("chat_sessions", filters={"id": session_id}, limit=1)
    return rows[0]["user_id"] if rows else None


def _get_caller_role(user_id: str) -> Optional[str]:
    """Explicit Python-layer role lookup -- mirrors useAuth.tsx's join
    (user_profiles.role_id -> roles.name) so the backend's notion of role
    never drifts from the frontend's."""
    rows = select_table("user_profiles", filters={"id": user_id}, limit=1)
    if not rows or not rows[0].get("role_id"):
        return None
    role_rows = select_table("roles", filters={"id": rows[0]["role_id"]}, limit=1)
    return role_rows[0]["name"] if role_rows else None


def assert_can_post_to_session(session_id: str, caller_user_id: str) -> None:
    """Even though the service role key bypasses chat_sessions/chat_messages
    RLS entirely, we must not let a privileged viewer post into someone
    else's session -- viewing is allowed, posting on their behalf is not.
    This is the explicit ownership check the project's standing principle
    requires whenever the service role key is in play."""
    owner = _get_session_owner(session_id)
    if owner is None:
        raise PermissionError_(f"Session {session_id} not found.")
    if owner != caller_user_id:
        raise PermissionError_("You can only post messages into your own chat sessions.")


def assert_can_view_session(session_id: str, caller_user_id: str) -> None:
    owner = _get_session_owner(session_id)
    if owner is None:
        raise PermissionError_(f"Session {session_id} not found.")
    if owner == caller_user_id:
        return
    role = _get_caller_role(caller_user_id)
    if role in PRIVILEGED_ROLES:
        return
    raise PermissionError_("You do not have permission to view this chat session.")


def create_session(user_id: str, title: str = "New conversation") -> dict[str, Any]:
    return insert_row("chat_sessions", {"user_id": user_id, "title": title})


def list_sessions(caller_user_id: str, view_all: bool = False) -> list[dict[str, Any]]:
    """view_all is only honored if the caller's role permits it -- this is
    checked here in Python, not assumed from the request."""
    if view_all:
        role = _get_caller_role(caller_user_id)
        if role not in PRIVILEGED_ROLES:
            raise PermissionError_("Only md/cfo/admin can view all chat sessions.")
        return select_table("chat_sessions", order_by="updated_at", descending=True, limit=200)
    return select_table(
        "chat_sessions",
        filters={"user_id": caller_user_id},
        order_by="updated_at",
        descending=True,
        limit=200,
    )


def get_messages(session_id: str, caller_user_id: str) -> list[dict[str, Any]]:
    assert_can_view_session(session_id, caller_user_id)
    return select_table(
        "chat_messages", filters={"session_id": session_id}, order_by="created_at", limit=500
    )


_HISTORY_TURNS = 6  # last N messages (3 user/assistant pairs) given to the LLM as context


def _load_recent_context(session_id: str) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Returns (history_for_prompt, last_assistant_sources).

    history_for_prompt: plain {role, content} pairs for the last few turns,
    so the LLM understands what a follow-up like "as well" or "in a table"
    is referring to.

    last_assistant_sources: the most recent assistant message's `sources`
    field (which RPC + params it called) -- NOT its rendered text. This
    lets a follow-up re-execute the SAME tool call to get a FRESH real
    result rather than asking the model to recall numbers it saw earlier
    as plain text, which would reintroduce exactly the hallucination risk
    the no-invented-numbers guardrail exists to prevent. Re-fetching is
    strictly safer than remembering.
    """
    rows = select_table(
        "chat_messages",
        filters={"session_id": session_id},
        order_by="created_at",
        descending=True,
        limit=_HISTORY_TURNS,
    )
    rows = list(reversed(rows))  # back to chronological order

    history = [{"role": r["role"], "content": r["content"]} for r in rows]

    last_assistant_sources: list[dict[str, Any]] = []
    for r in reversed(rows):
        if r["role"] == "assistant" and r.get("sources"):
            last_assistant_sources = r["sources"]
            break

    return history, last_assistant_sources


def handle_turn(session_id: str, caller_user_id: str, message: str) -> ChatTurnResult:
    assert_can_post_to_session(session_id, caller_user_id)

    # Load context BEFORE inserting the new user message, so "history"
    # genuinely means "everything before this turn" -- not including the
    # message we're about to answer.
    history, last_sources = _load_recent_context(session_id)

    user_row = insert_row(
        "chat_messages",
        {"session_id": session_id, "role": "user", "content": message, "sources": []},
    )

    routed = try_route(message)
    if routed is not None:
        answer, sources, route = routed.answer, routed.sources, routed.route
    else:
        result = ask_with_tools(message, conversation_history=history, last_sources=last_sources)
        answer, sources, route = result.answer, result.sources, result.route

    assistant_row = insert_row(
        "chat_messages",
        {
            "session_id": session_id,
            "role": "assistant",
            "content": answer,
            "sources": sources,
            "route": route,
        },
    )

    return ChatTurnResult(
        session_id=session_id,
        user_message_id=user_row["id"],
        assistant_message_id=assistant_row["id"],
        answer=answer,
        sources=sources,
        route=route,
    )