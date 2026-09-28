"""
cfo_tower/chat_sales/chat_routes_sales.py

FastAPI routes for the Sales Analyst chatbot. Mounted at prefix
/chat-sales, entirely separate from the CFO chatbot's /chat prefix --
different tables, different tool surface, same JWT verification
mechanism (auth_sales.py, a duplicate of chat/auth.py).

SECURITY NOTE: same as chat_routes.py -- every route depends on
get_verified_user_id, which derives the real user id from a verified
Supabase JWT. None of these routes accept a self-reported user_id.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import chat_service_sales
from .auth_sales import get_verified_user_id
from .chat_service_sales import PermissionError_
from .supabase_client_sales import SupabaseCallError

router = APIRouter(prefix="/chat-sales", tags=["chat-sales"])


class CreateSessionRequest(BaseModel):
    title: str | None = None


class AskRequest(BaseModel):
    session_id: str
    message: str


@router.post("/sessions")
def create_session(
    req: CreateSessionRequest,
    user_id: str = Depends(get_verified_user_id),
):
    try:
        return chat_service_sales.create_session(user_id, req.title or "New conversation")
    except SupabaseCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/sessions")
def list_sessions(
    view_all: bool = False,
    user_id: str = Depends(get_verified_user_id),
):
    try:
        return chat_service_sales.list_sessions(user_id, view_all=view_all)
    except PermissionError_ as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except SupabaseCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/sessions/{session_id}/messages")
def get_messages(
    session_id: str,
    user_id: str = Depends(get_verified_user_id),
):
    try:
        return chat_service_sales.get_messages(session_id, user_id)
    except PermissionError_ as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except SupabaseCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/ask")
def ask(
    req: AskRequest,
    user_id: str = Depends(get_verified_user_id),
):
    try:
        result = chat_service_sales.handle_turn(req.session_id, user_id, req.message)
        return {
            "session_id": result.session_id,
            "answer": result.answer,
            "sources": result.sources,
            "route": result.route,
        }
    except PermissionError_ as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except SupabaseCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ============================================================================
# WIRING INSTRUCTIONS for cfo_server.py
# ============================================================================
#
# 1. Create a new folder cfo_tower/chat_sales/ next to cfo_tower/chat/
#    (the existing CFO chatbot) and cfo_tower/integrations/. Place these
#    files in it:
#       router_sales.py
#       llm_tools_sales.py
#       chat_service_sales.py
#       chat_routes_sales.py   (this file)
#       supabase_client_sales.py
#       auth_sales.py
#       __init__.py            (empty file, same as cfo_tower/chat/__init__.py)
#
# 2. No new pip dependencies -- reuses requests/PyJWT/fastapi already
#    installed for the CFO chatbot.
#
# 3. In cfo_server.py, alongside your existing chat_router import, add:
#       from cfo_tower.chat_sales.chat_routes_sales import router as chat_sales_router
#
# 4. Wherever you do `app.include_router(chat_router)`, add immediately after:
#       app.include_router(chat_sales_router)
#
# 5. No new .env vars needed -- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#    and LLAMA_CPP_URL are all reused from the existing chat setup.
#
# 6. Run migration 032_sales_chat_tables.sql against ais-cfo-tower before
#    starting cfo_server.py.
#
# 7. Restart cfo_server.py. New endpoints (all require a valid
#    `Authorization: Bearer <supabase access token>` header):
#       POST /chat-sales/sessions              {title?}
#       GET  /chat-sales/sessions?view_all=false
#       GET  /chat-sales/sessions/{id}/messages
#       POST /chat-sales/ask                   {session_id, message}
#
# 8. Frontend: needs a SalesChatWidget component, separate from the
#    existing ChatWidget.tsx, pointed at /chat-sales instead of /chat.
#    Not built yet -- see note in chat conversation about needing the
#    real ChatWidget.tsx first to mirror its UI (fullscreen toggle,
#    markdown table rendering, CSV export) rather than guessing at it.
# ============================================================================
