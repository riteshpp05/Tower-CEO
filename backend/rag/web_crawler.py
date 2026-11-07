# ============================================================
# web_crawler.py
# WHAT THIS DOES:
# Reads URLs from crawl_list.txt
# Fetches each webpage using requests library
# Extracts clean readable text using BeautifulSoup
# Saves each page as a .txt file in crawled_pages/
#
# WHAT IT DOES NOT DO:
# - Does NOT send your data anywhere
# - Does NOT crawl links inside pages (only exact URLs you list)
# - Does NOT run automatically (you run it manually)
#
# FLOW:
# crawl_list.txt → fetch page → clean text → save .txt file
# ============================================================

import os
import re
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from datetime import datetime

# ── SETTINGS ────────────────────────────────────────────────
CRAWL_LIST  = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\crawled_pages\crawl_list.txt"
SAVE_FOLDER = r"F:\Visual Code Directory\APNJ-LLM-Studio\data\crawled_pages"

# How long to wait between fetching pages (be polite to servers)
DELAY_SECONDS = 2

# Max characters to save per page (prevents huge files)
MAX_CHARS = 50000

# Browser identity string — some sites block Python requests
# This makes us look like a normal Chrome browser
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
}


def load_urls():
    """
    Read URLs from crawl_list.txt.
    Skips blank lines and lines starting with #
    """
    if not os.path.exists(CRAWL_LIST):
        print(f"ERROR: crawl_list.txt not found at:\n{CRAWL_LIST}")
        return []

    urls = []
    with open(CRAWL_LIST, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                urls.append(line)

    return urls


def url_to_filename(url):
    """
    Convert a URL to a safe filename.

    Example:
    https://www.incometax.gov.in/iec/foportal/
    → incometax_gov_in_iec_foportal.txt

    WHY? File names can't have // : ? & etc.
    We strip those and replace with underscores.
    """
    parsed = urlparse(url)
    # Combine domain + path
    name = parsed.netloc + parsed.path
    # Remove trailing slash
    name = name.rstrip("/")
    # Replace unsafe characters with underscore
    name = re.sub(r'[^a-zA-Z0-9]', '_', name)
    # Collapse multiple underscores
    name = re.sub(r'_+', '_', name)
    # Trim and add extension
    name = name.strip('_')[:80]
    return name + ".txt"


def extract_text(html, url):
    """
    Extract clean readable text from HTML.

    WHY BeautifulSoup?
    A raw webpage has thousands of lines of HTML tags,
    JavaScript, CSS, navigation menus etc.
    BeautifulSoup strips all that and gives us just
    the actual readable content — like the article text,
    headings, paragraphs.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Remove script and style blocks completely
    # These contain code, not readable content
    for tag in soup(["script", "style", "nav",
                     "footer", "header", "iframe",
                     "noscript", "aside"]):
        tag.decompose()

    # Extract title
    title = soup.find("title")
    title_text = title.get_text().strip() if title else "No Title"

    # Extract meta description if available
    meta = soup.find("meta", attrs={"name": "description"})
    description = meta.get("content", "").strip() if meta else ""

    # Extract main content
    # Try to find article/main content area first
    main = (soup.find("main") or
            soup.find("article") or
            soup.find(id="content") or
            soup.find(id="main-content") or
            soup.find(class_="content") or
            soup.body)

    if main:
        text = main.get_text(separator="\n")
    else:
        text = soup.get_text(separator="\n")

    # Clean up whitespace
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if len(line) > 20:           # Skip very short lines (nav items etc)
            lines.append(line)

    clean_text = "\n".join(lines)

    # Build the final saved content
    # We add metadata at the top so the AI knows where this came from
    saved_content = f"""SOURCE URL: {url}
TITLE: {title_text}
DESCRIPTION: {description}
CRAWLED: {datetime.now().strftime('%Y-%m-%d %H:%M')}
{'='*60}

{clean_text[:MAX_CHARS]}
"""
    return saved_content, title_text


def crawl_url(url, index, total):
    """
    Fetch one URL and save its content.
    Returns True if successful, False if failed.
    """
    filename = url_to_filename(url)
    filepath = os.path.join(SAVE_FOLDER, filename)

    print(f"\n[{index}/{total}] Fetching: {url}")
    print(f"    Saving to: {filename}")

    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=15,           # Give up after 15 seconds
            allow_redirects=True  # Follow redirects (http → https etc)
        )

        # Check if we got a good response
        # 200 = OK, anything else is a problem
        if response.status_code != 200:
            print(f"    ❌ HTTP {response.status_code} — skipping")
            return False

        # Extract clean text
        content, title = extract_text(response.text, url)

        # Save to file
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

        size_kb = len(content) / 1024
        print(f"    ✅ Saved: '{title[:50]}' ({size_kb:.1f} KB)")
        return True

    except requests.exceptions.Timeout:
        print(f"    ❌ Timeout — page took too long to respond")
        return False

    except requests.exceptions.ConnectionError:
        print(f"    ❌ Cannot connect — check your internet connection")
        return False

    except Exception as e:
        print(f"    ❌ Error: {e}")
        return False


def crawl_all():
    """Main function — crawl all URLs in the list."""
    print("=" * 55)
    print("APNJ Web Crawler")
    print("=" * 55)
    print(f"\nURL List : {CRAWL_LIST}")
    print(f"Save To  : {SAVE_FOLDER}\n")

    # Load URLs
    urls = load_urls()

    if not urls:
        print("No URLs found in crawl_list.txt")
        print("Add URLs to the file and run again.")
        return

    print(f"Found {len(urls)} URL(s) to crawl:\n")
    for u in urls:
        print(f"  • {u}")

    print(f"\nStarting crawl with {DELAY_SECONDS}s delay between pages...")
    print("(Delay is polite — it avoids overloading servers)\n")

    success = 0
    failed  = 0

    for i, url in enumerate(urls, 1):
        ok = crawl_url(url, i, len(urls))
        if ok:
            success += 1
        else:
            failed += 1

        # Wait between requests (except after the last one)
        if i < len(urls):
            print(f"    ⏳ Waiting {DELAY_SECONDS}s...")
            time.sleep(DELAY_SECONDS)

    print(f"\n{'='*55}")
    print(f"Crawl Complete!")
    print(f"  Saved:  {success} page(s)")
    print(f"  Failed: {failed} page(s)")
    print(f"\nSaved files are in:")
    print(f"  {SAVE_FOLDER}")
    print(f"\nNext step: Run web_indexer.py to index for AI search")


if __name__ == "__main__":
    crawl_all()