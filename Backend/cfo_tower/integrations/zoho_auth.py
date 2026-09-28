"""
Zoho OAuth token manager.

Access tokens expire after 1 hour. This module silently mints a fresh
access token using the permanent refresh_token whenever needed, and
caches it in memory until it's close to expiry.

No manual re-authorization is ever needed after the one-time setup
(exchange_zoho_token.py) UNLESS the refresh_token itself is revoked
in the Zoho API console.
"""

import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

ZOHO_CLIENT_ID = os.environ["ZOHO_CLIENT_ID"]
ZOHO_CLIENT_SECRET = os.environ["ZOHO_CLIENT_SECRET"]
ZOHO_REFRESH_TOKEN = os.environ["ZOHO_REFRESH_TOKEN"]
ZOHO_ACCOUNTS_URL = os.environ["ZOHO_ACCOUNTS_URL"]
ZOHO_BOOKS_ORG_ID = os.environ["ZOHO_BOOKS_ORG_ID"]
ZOHO_BOOKS_API_BASE = os.environ["ZOHO_BOOKS_API_BASE"]

_cached_token = {"access_token": None, "expires_at": 0}


def get_access_token() -> str:
    """
    Returns a valid access token, refreshing it if the cached one
    has expired (or is within 60s of expiring, to avoid race conditions
    on slow requests).
    """
    now = time.time()
    if _cached_token["access_token"] and now < _cached_token["expires_at"] - 60:
        return _cached_token["access_token"]

    url = f"{ZOHO_ACCOUNTS_URL}/oauth/v2/token"
    params = {
        "grant_type": "refresh_token",
        "client_id": ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "refresh_token": ZOHO_REFRESH_TOKEN,
    }
    resp = requests.post(url, params=params, timeout=15)
    data = resp.json()

    if "access_token" not in data:
        raise RuntimeError(
            f"Zoho token refresh failed: {data}. "
            f"If error is 'invalid_code' or similar, the refresh_token may "
            f"have been revoked — re-run exchange_zoho_token.py to re-authorize."
        )

    _cached_token["access_token"] = data["access_token"]
    _cached_token["expires_at"] = now + data.get("expires_in", 3600)
    return _cached_token["access_token"]


def zoho_books_headers() -> dict:
    """Standard headers for any Zoho Books API call."""
    return {"Authorization": f"Zoho-oauthtoken {get_access_token()}"}


def zoho_books_get(endpoint: str, extra_params: dict | None = None) -> dict:
    """
    GET request to a Zoho Books v3 endpoint, automatically including
    organization_id (required on every call) and a fresh access token.

    endpoint example: "invoices", "vendorbills", "contacts"
    """
    url = f"{ZOHO_BOOKS_API_BASE}/{endpoint}"
    params = {"organization_id": ZOHO_BOOKS_ORG_ID}
    if extra_params:
        params.update(extra_params)

    resp = requests.get(url, headers=zoho_books_headers(), params=params, timeout=30)

    if resp.status_code == 401:
        # Access token might have been invalidated server-side; force one retry
        _cached_token["access_token"] = None
        resp = requests.get(url, headers=zoho_books_headers(), params=params, timeout=30)

    resp.raise_for_status()
    return resp.json()
