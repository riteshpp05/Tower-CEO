"""
APNJ LLM Studio - Local CORS Proxy + Static Server
====================================================
- Serves APNJ-LLM-Studio.html at http://127.0.0.1:3000
- Proxies /v1/* and /health requests to llama-server (port 8080)
- Proxies /rag/*  requests to RAG server      (port 3001)

Usage: python proxy.py
Then open: http://127.0.0.1:3000
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json
import os
import sys

# ── CONFIG ────────────────────────────────────────────────────
PROXY_PORT   = 3000
LLAMA_SERVER = "http://127.0.0.1:8080"   # Gemma chat model
RAG_SERVER   = "http://127.0.0.1:3001"   # RAG server
JARVIS_SERVER = "http://127.0.0.1:3004"  # Jarvis backend
STUDIO_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "APNJ-LLM-Studio.html")
# ─────────────────────────────────────────────────────────────


class ProxyHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        method = args[0].split()[0] if args else ''
        path   = args[0].split()[1] if args and len(args[0].split()) > 1 else ''
        status = args[1] if len(args) > 1 else ''
        print(f"  [{status}] {method} {path}")

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin",          "*")
        self.send_header("Access-Control-Allow-Methods",         "GET, POST, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers",         "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age",               "86400")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html", "/APNJ-LLM-Studio.html"):
            self.serve_studio()
        else:
            self.proxy_request("GET")

    def do_POST(self):
        self.proxy_request("POST")

    def do_PUT(self):
        self.proxy_request("PUT")

    def do_DELETE(self):
        self.proxy_request("DELETE")

    def serve_studio(self):
        try:
            with open(STUDIO_FILE, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type",   "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            error = b"<h1>APNJ-LLM-Studio.html not found!</h1>"
            self.send_response(404)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(error)))
            self.end_headers()
            self.wfile.write(error)

    def proxy_request(self, method):
        if self.path.startswith("/rag/"):
            target_url = RAG_SERVER + self.path
        elif self.path.startswith("/jarvis/"):
            target_url = JARVIS_SERVER + self.path[len("/jarvis"):]
        else:
            target_url = LLAMA_SERVER + self.path

        body = None
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            body = self.rfile.read(content_length)

        req = urllib.request.Request(url=target_url, data=body, method=method)

        # Forward ALL headers except Host and Connection
        for key, value in self.headers.items():
            if key.lower() not in ("host", "connection"):
                req.add_header(key, value)

        try:
            with urllib.request.urlopen(req, timeout=3600) as response:
                response_body = response.read()
                self.send_response(response.status)
                self.send_cors_headers()
                resp_content_type = response.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type",   resp_content_type)
                self.send_header("Content-Length", str(len(response_body)))
                self.end_headers()
                self.wfile.write(response_body)

        except urllib.error.HTTPError as e:
            error_body = e.read()
            self.send_response(e.code)
            self.send_cors_headers()
            self.send_header("Content-Type",   "application/json")
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)

        except urllib.error.URLError as e:
            error_msg = json.dumps({
                "error": "Cannot reach server",
                "detail": str(e.reason),
                "hint": f"Target was: {target_url}"
            }).encode()
            self.send_response(503)
            self.send_cors_headers()
            self.send_header("Content-Type",   "application/json")
            self.send_header("Content-Length", str(len(error_msg)))
            self.end_headers()
            self.wfile.write(error_msg)

        except Exception as e:
            error_msg = json.dumps({"error": str(e)}).encode()
            self.send_response(500)
            self.send_cors_headers()
            self.send_header("Content-Type",   "application/json")
            self.send_header("Content-Length", str(len(error_msg)))
            self.end_headers()
            self.wfile.write(error_msg)


def main():
    print()
    print("  +==========================================+")
    print("  |   APNJ LLM Studio - Proxy + Server      |")
    print("  +==========================================+")
    print()
    print(f"  Studio URL   : http://127.0.0.1:{PROXY_PORT}")
    print(f"  Chat Model   : {LLAMA_SERVER}  (Gemma)")
    print(f"  RAG Server   : {RAG_SERVER}  (RAG)")
    print(f"  Studio File  : {STUDIO_FILE}")
    print()
    print("  Status: Running - DO NOT CLOSE THIS WINDOW")
    print("  -----------------------------------------")
    print("  Requests:")
    print()

    try:
        server = HTTPServer(("0.0.0.0", PROXY_PORT), ProxyHandler)
        server.serve_forever()
    except KeyboardInterrupt:
        print()
        print("  Proxy stopped.")
        sys.exit(0)
    except OSError as e:
        if "10048" in str(e) or "Address already in use" in str(e):
            print(f"  ERROR: Port {PROXY_PORT} already in use!")
        else:
            print(f"  ERROR: {e}")
        input("  Press Enter to close...")
        sys.exit(1)


if __name__ == "__main__":
    main()