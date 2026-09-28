"""
cfo_tower/chat_sales/chat_service_sales.py

Orchestrates a single Sales chat turn -- same shape as chat/chat_service.py:
  1. Try the deterministic router (router_sales.try_route).
  2. Fall back to LLM tool-calling (llm_tools_sales.ask_with_tools).
  3. Persist to chat_sales_messages / chat_sales_sessions (NOT the CFO
     chatbot's tables -- see migration 032).

Same explicit-ownership-check principle as the CFO chatbot: the service
role key bypasses RLS, so ownership is re-verified here in Python before
any read/write on a user's behalf.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .llm_tools_sales import ask_with_tools
from .router_sales import try_route
from .supabase_client_sales import select_table, insert_row, SupabaseCallError

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
    rows = select_table("chat_sales_sessions", filters={"id": session_id}, limit=1)
    return rows[0]["user_id"] if rows else None


def _get_caller_role(user_id: str) -> Optional[str]:
    rows = select_table("user_profiles", filters={"id": user_id}, limit=1)
    if not rows or not rows[0].get("role_id"):
        return None
    role_rows = select_table("roles", filters={"id": rows[0]["role_id"]}, limit=1)
    return role_rows[0]["name"] if role_rows else None


def assert_can_post_to_session(session_id: str, caller_user_id: str) -> None:
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
    return insert_row("chat_sales_sessions", {"user_id": user_id, "title": title})


def list_sessions(caller_user_id: str, view_all: bool = False) -> list[dict[str, Any]]:
    if view_all:
        role = _get_caller_role(caller_user_id)
        if role not in PRIVILEGED_ROLES:
            raise PermissionError_("Only md/cfo/admin can view all chat sessions.")
        return select_table("chat_sales_sessions", order_by="updated_at", descending=True, limit=200)
    return select_table(
        "chat_sales_sessions",
        filters={"user_id": caller_user_id},
        order_by="updated_at",
        descending=True,
        limit=200,
    )


def get_messages(session_id: str, caller_user_id: str) -> list[dict[str, Any]]:
    assert_can_view_session(session_id, caller_user_id)
    return select_table(
        "chat_sales_messages", filters={"session_id": session_id}, order_by="created_at", limit=500
    )


_HISTORY_TURNS = 6


def _load_recent_context(session_id: str) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    rows = select_table(
        "chat_sales_messages",
        filters={"session_id": session_id},
        order_by="created_at",
        descending=True,
        limit=_HISTORY_TURNS,
    )
    rows = list(reversed(rows))

    history = [{"role": r["role"], "content": r["content"]} for r in rows]

    last_assistant_sources: list[dict[str, Any]] = []
    for r in reversed(rows):
        if r["role"] == "assistant" and r.get("sources"):
            last_assistant_sources = r["sources"]
            break

    return history, last_assistant_sources


def handle_turn(session_id: str, caller_user_id: str, message: str) -> ChatTurnResult:
    assert_can_post_to_session(session_id, caller_user_id)

    history, last_sources = _load_recent_context(session_id)

    user_row = insert_row(
        "chat_sales_messages",
        {"session_id": session_id, "role": "user", "content": message, "sources": []},
    )

    routed = try_route(message)
    if routed is not None:
        answer, sources, route = routed.answer, routed.sources, routed.route
    else:
        result = ask_with_tools(message, conversation_history=history, last_sources=last_sources)
        answer, sources, route = result.answer, result.sources, result.route

    assistant_row = insert_row(
        "chat_sales_messages",
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
