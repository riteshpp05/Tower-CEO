"""
update_tunnel_url.py
====================================================
Starts a Cloudflare quick tunnel for http://127.0.0.1:3000, captures the
generated *.trycloudflare.com URL, and writes it into Supabase app_config
(key = 'llm_tunnel_url') so the Vercel app picks it up automatically — no
rebuild/redeploy needed when the URL changes after a PC restart.

Run this INSTEAD of launching cloudflared directly.
Usage: python update_tunnel_url.py
"""

import subprocess
import re
import sys
import json
import urllib.request

# ── CONFIG ────────────────────────────────────────
SUPABASE_URL = "https://mfhnszgdwzunfgtmkviw.supabase.co"
SUPABASE_KEY = "sb_publishable_qx-3wtsPID1EHLenvYhc1g_DWZLnsZU"
CLOUDFLARED  = r"C:\Program Files (x86)\cloudflared\cloudflared.exe"
LOCAL_TARGET = "http://127.0.0.1:3000"
# ─────────────────────────────────────────────────


def write_url_to_supabase(url: str) -> bool:
    """Upsert the tunnel URL into app_config via Supabase REST."""
    endpoint = f"{SUPABASE_URL}/rest/v1/app_config"
    payload = json.dumps({"key": "llm_tunnel_url", "value": url, "updated_at": "now()"}).encode()
    req = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",  # upsert on primary key
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            ok = resp.status in (200, 201, 204)
            print(f"  [Supabase] wrote tunnel URL -> {url}  (status {resp.status})")
            return ok
    except Exception as e:
        print(f"  [Supabase] FAILED to write URL: {e}")
        return False


def main():
    print()
    print("  +==========================================+")
    print("  |   APNJ Tunnel + Auto-URL Updater        |")
    print("  +==========================================+")
    print(f"  Target : {LOCAL_TARGET}")
    print(f"  Studio writes URL into Supabase app_config")
    print("  Status : starting tunnel...")
    print()

    # Launch cloudflared and stream its output
    proc = subprocess.Popen(
        [CLOUDFLARED, "tunnel", "--url", LOCAL_TARGET],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    url_pattern = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
    url_written = False

    try:
        for line in proc.stdout:
            print("  " + line.rstrip())
            if not url_written:
                m = url_pattern.search(line)
                if m:
                    tunnel_url = m.group(0)
                    print()
                    print(f"  >>> Tunnel URL detected: {tunnel_url}")
                    write_url_to_supabase(tunnel_url)
                    url_written = True
                    print("  >>> App will use this automatically. No Vercel changes needed.")
                    print()
    except KeyboardInterrupt:
        print("\n  Stopping tunnel...")
        proc.terminate()
        sys.exit(0)


if __name__ == "__main__":
    main()
