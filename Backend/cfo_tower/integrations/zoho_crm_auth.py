"""
zoho_crm_auth.py

Zoho CRM OAuth token manager — mirrors integrations/zoho_auth.py exactly,
but for CRM's separate Self Client (different scopes, different refresh
token than Books, even though both hit the same accounts.zoho.in server).

Place at: cfo_tower/integrations/zoho_crm_auth.py

Access tokens expire after 1 hour. This module silently mints a fresh
one using the permanent refresh_token whenever needed, and caches it in
memory until it's close to expiry — same behavior as zoho_auth.py.

Required .env additions (alongside your existing ZOHO_* Books vars):
    ZOHO_CRM_CLIENT_ID
    ZOHO_CRM_CLIENT_SECRET
    ZOHO_CRM_REFRESH_TOKEN
    ZOHO_CRM_API_BASE=https://www.zohoapis.in/crm/v6

Reuses your existing ZOHO_ACCOUNTS_URL — the accounts server (accounts.zoho.in)
is shared across Books and CRM; only the API base and credentials differ.
"""

import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

ZOHO_CRM_CLIENT_ID = os.environ["ZOHO_CRM_CLIENT_ID"]
ZOHO_CRM_CLIENT_SECRET = os.environ["ZOHO_CRM_CLIENT_SECRET"]
ZOHO_CRM_REFRESH_TOKEN = os.environ["ZOHO_CRM_REFRESH_TOKEN"]
ZOHO_ACCOUNTS_URL = os.environ["ZOHO_ACCOUNTS_URL"]  # shared with Books
ZOHO_CRM_API_BASE = os.environ["ZOHO_CRM_API_BASE"]

_cached_token = {"access_token": None, "expires_at": 0}


def get_crm_access_token() -> str:
    """
    Returns a valid CRM access token, refreshing it if the cached one
    has expired (or is within 60s of expiring). Same caching behavior
    as zoho_auth.get_access_token() — deliberately separate cache dict
    since CRM and Books tokens are entirely independent.
    """
    now = time.time()
    if _cached_token["access_token"] and now < _cached_token["expires_at"] - 60:
        return _cached_token["access_token"]

    url = f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token"
    params = {
        "grant_type": "refresh_token",
        "client_id": ZOHO_CRM_CLIENT_ID,
        "client_secret": ZOHO_CRM_CLIENT_SECRET,
        "refresh_token": ZOHO_CRM_REFRESH_TOKEN,
    }
    resp = requests.post(url, params=params, timeout=15)
    data = resp.json()

    if "access_token" not in data:
        raise RuntimeError(
            f"Zoho CRM token refresh failed: {data}. "
            f"If error is 'invalid_code' or similar, the refresh_token may "
            f"have been revoked — re-run the CRM OAuth exchange to re-authorize."
        )

    _cached_token["access_token"] = data["access_token"]
    _cached_token["expires_at"] = now + data.get("expires_in", 3600)
    return _cached_token["access_token"]


def zoho_crm_headers() -> dict:
    """Standard headers for any Zoho CRM API call."""
    return {"Authorization": f"Zoho-oauthtoken {get_crm_access_token()}"}


def zoho_crm_get(endpoint: str, extra_params: dict | None = None) -> dict:
    """
    GET request to a Zoho CRM v6 endpoint, with a fresh access token.
    Unlike zoho_books_get, CRM does NOT need an organization_id param —
    module-level access is scoped by the OAuth token's authorized user.

    endpoint example: "Deals", "Users"
    """
    url = f"{ZOHO_CRM_API_BASE}/{endpoint}"
    params = extra_params or {}

    resp = requests.get(url, headers=zoho_crm_headers(), params=params, timeout=30)

    if resp.status_code == 401:
        # Access token might have been invalidated server-side; force one retry
        _cached_token["access_token"] = None
        resp = requests.get(url, headers=zoho_crm_headers(), params=params, timeout=30)

    if resp.status_code == 204:
        # Zoho CRM (unlike Books) returns 204 with an empty body when a
        # page has no records, rather than an empty array — .json() would
        # throw on an empty body, so short-circuit here.
        return {}

    resp.raise_for_status()
    return resp.json()
