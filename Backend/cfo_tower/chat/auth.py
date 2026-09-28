"""
cfo_tower/chat/auth.py

Verifies the Supabase-issued JWT the frontend already holds (the same
access_token useAuth.tsx gets from supabase.auth session) and derives a
TRUSTED user id from it -- rather than trusting a `user_id` field the
caller can set to anything in a request body.

WHY THIS EXISTS (read before removing it):
The chat endpoints originally took `user_id: str` straight from the
request body/query string. That is a self-reported field -- anyone on the
LAN who can reach cfo_server.py (which is bound to 0.0.0.0, per the
project's existing LAN-access design) could pass ANY user's id and read
that user's private chat history, or post messages into their session.
That defeats the entire point of "private by default, CFO/MD/admin can
view" -- the privacy boundary only means something if user identity is
verified, not asserted.

SIGNING KEY SYSTEM (read this if you ever see auth errors after a Supabase
dashboard change):
This project (ais-cfo-tower) uses Supabase's newer asymmetric JWT signing
keys system (ES256 / Elliptic Curve), not the older shared-secret HS256
system. That means there is no single "JWT secret" to copy into .env --
instead, tokens are verified against a PUBLIC key that Supabase publishes
at a JWKS (JSON Web Key Set) endpoint:

    https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json

This module fetches that endpoint via PyJWT's built-in PyJWKClient (no
extra dependency beyond PyJWT, which is already required), caches the
public key, and verifies each incoming token locally -- no secret needs
to be stored in .env at all for this to work. If your Supabase project is
ever rotated back to a legacy HS256 shared secret, see the
_verify_hs256_fallback() function below, which is wired in automatically
based on the token's own `alg` header -- no code changes needed either way.
"""

from __future__ import annotations

import os
import time

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError

SUPABASE_URL = os.environ["SUPABASE_URL"]
_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"

# Optional: only needed if this project ever falls back to the legacy
# shared-secret (HS256) signing system. Not required for the current
# ES256/JWKS setup -- safe to leave unset.
_LEGACY_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")

# PyJWKClient caches fetched keys internally and only re-fetches when it
# sees a `kid` (key id) it doesn't recognize yet -- so this is cheap to
# call on every request, not a network round-trip every time.
_jwks_client = PyJWKClient(_JWKS_URL)

# Retry config for the JWKS fetch specifically. This is here because a
# transient DNS/network blip (confirmed to happen at least once on this
# project -- a single getaddrinfo failure that resolved fine on the very
# next manual check) would otherwise turn one bad network moment into a
# failed login-verification for whoever happened to ask a question right
# then. Retrying a few times with a short backoff costs at most ~1.5s on
# the rare occasion it's needed, and costs nothing at all the rest of the
# time, since a successful fetch never reaches the retry loop's later steps.
_JWKS_FETCH_RETRIES = 3
_JWKS_FETCH_BACKOFF_SECONDS = 0.5


def _verify_es256(token: str) -> dict:
    last_error: Exception | None = None
    for attempt in range(_JWKS_FETCH_RETRIES):
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            return jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated")
        except PyJWKClientConnectionError as exc:
            last_error = exc
            if attempt < _JWKS_FETCH_RETRIES - 1:
                time.sleep(_JWKS_FETCH_BACKOFF_SECONDS * (attempt + 1))
    # All retries exhausted -- this is a real, persistent connectivity
    # problem (not a one-off blip), surfaced as 503 rather than a generic
    # 500 so it's distinguishable from "your token is invalid" -- this is
    # "the server couldn't verify ANY token right now, try again shortly."
    raise HTTPException(
        status_code=503,
        detail=(
            "Could not reach Supabase to verify your session (network issue on "
            "the server's end, not your token). Please try again in a moment."
        ),
    ) from last_error


def _verify_hs256_fallback(token: str) -> dict:
    if not _LEGACY_JWT_SECRET:
        raise HTTPException(
            status_code=401,
            detail=(
                "Received an HS256-signed token but SUPABASE_JWT_SECRET is not "
                "set. This project uses ES256 signing keys -- if you're seeing "
                "this, something changed in your Supabase project's JWT "
                "settings. Check Project Settings -> JWT Keys in the dashboard."
            ),
        )
    return jwt.decode(token, _LEGACY_JWT_SECRET, algorithms=["HS256"], audience="authenticated")


def get_verified_user_id(authorization: str = Header(...)) -> str:
    """FastAPI dependency. Expects an `Authorization: Bearer <access_token>`
    header -- the frontend already has this via `supabase.auth.getSession()`
    / `useAuth()`'s session object, so no new login flow is needed.

    Raises 401 if the header is missing, malformed, or the token doesn't
    verify -- this is the actual security boundary; everything downstream
    (chat_service.py's ownership checks) only works correctly because the
    user_id it receives here is real, not self-reported.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")

    token = authorization[len("Bearer "):]

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token.")

    try:
        if header.get("alg") == "ES256":
            payload = _verify_es256(token)
        else:
            payload = _verify_hs256_fallback(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token.")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user id.")
    return user_id