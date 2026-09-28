"""
cfo_tower/chat/chat_routes.py

FastAPI routes for the AI Analyst chatbot. Drops into the existing
cfo_server.py with one import line and one app.include_router() call --
see WIRING INSTRUCTIONS at the bottom of this file.

SECURITY NOTE (read this before changing the signatures below):
Every route depends on get_verified_user_id (auth.py), which verifies the
caller's Supabase JWT and extracts the real user id from its `sub` claim.
None of these routes accept `user_id` as a request parameter anymore --
an earlier version of this file did, and that was a real bug: a
self-reported user_id lets anyone on the LAN impersonate anyone else and
read or post into their private chat history. If you ever need to remove
the JWT dependency for local testing, do NOT silently fall back to a
request-supplied user_id in production -- that reintroduces the same hole.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import chat_service
from .auth import get_verified_user_id
from .chat_service import PermissionError_
from .supabase_client import SupabaseCallError

router = APIRouter(prefix="/chat", tags=["chat"])


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
        return chat_service.create_session(user_id, req.title or "New conversation")
    except SupabaseCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/sessions")
def list_sessions(
    view_all: bool = False,
    user_id: str = Depends(get_verified_user_id),
):
    try:
        return chat_service.list_sessions(user_id, view_all=view_all)
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
        return chat_service.get_messages(session_id, user_id)
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
        result = chat_service.handle_turn(req.session_id, user_id, req.message)
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
# 1. Copy this entire cfo_tower/chat/ folder (router.py, supabase_client.py,
#    llm_tools.py, chat_service.py, chat_routes.py, auth.py, __init__.py)
#    next to your existing cfo_tower/integrations/ folder.
#
# 2. Add the two new dependencies to your venv:
#       pip install requests PyJWT --break-system-packages
#
# 3. In cfo_server.py, near your other imports, add:
#       from cfo_tower.chat.chat_routes import router as chat_router
#
# 4. Wherever you do `app = FastAPI(...)`, add immediately after:
#       app.include_router(chat_router)
#
# 5. Make sure these are set in cfo_tower/.env (same file your Zoho OAuth
#    secrets already live in):
#       SUPABASE_URL=https://qmmanlhtbgxekzbtlgsn.supabase.co
#       SUPABASE_SERVICE_ROLE_KEY=<service role key, NOT the anon key>
#       SUPABASE_JWT_SECRET=<JWT secret, NOT the anon key or service role key>
#       LLAMA_CPP_URL=http://localhost:8080   (optional, this is the default)
#
#    Get SUPABASE_SERVICE_ROLE_KEY from Supabase dashboard -> Project
#    Settings -> API -> service_role secret.
#    Get SUPABASE_JWT_SECRET from the same page -> JWT Settings -> JWT Secret.
#    Both are DIFFERENT from VITE_SUPABASE_ANON_KEY -- never put either in
#    the frontend .env or any VITE_ prefixed variable.
#
# 6. Run migrations/024_chat_sessions_messages.sql against the
#    ais-cfo-tower Supabase project before starting cfo_server.py.
#
# 7. Restart cfo_server.py. New endpoints (all require a valid
#    `Authorization: Bearer <supabase access token>` header):
#       POST /chat/sessions              {title?}
#       GET  /chat/sessions?view_all=false
#       GET  /chat/sessions/{id}/messages
#       POST /chat/ask                   {session_id, message}
#
# 8. Frontend: ChatWidget.tsx already reads `session.access_token` from
#    useAuth() and sends it as the Authorization header on every request
#    to these endpoints (see the updated ChatWidget.tsx). No frontend
#    action needed beyond using the updated file.
# ============================================================================
