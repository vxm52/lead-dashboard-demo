import hashlib
import json
import os
import re
import shutil
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DATA_BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "data-backup")
DATA_STATE_FILE = os.path.join(DATA_DIR, "data-state.json")

# Data files we track for change detection
DATA_FILES = {
    "socrata_90th": "socrata-90th-percentile.json",
    "dsmi": "DSMI-Service-Line-Materials-Estimates.xlsx",
    "lslr": "2024-2025-LSLR-Data.xlsx",
}

SOURCE_NAMES = {
    "socrata_90th": "Socrata 90th Percentile API",
    "dsmi": "DSMI Service Line Materials",
    "lslr": "Lead & Copper Rule (LSLR)",
}


def get_file_hash(path):
    """Generate MD5 hash of file contents."""
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def load_data_state():
    """Load previous data state from file."""
    try:
        with open(DATA_STATE_FILE, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_data_state(state):
    """Save current data state to file."""
    with open(DATA_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def backup_data():
    """Backup existing data/ contents to data-backup/."""
    if os.path.exists(DATA_BACKUP_DIR):
        shutil.rmtree(DATA_BACKUP_DIR)
    if os.path.exists(DATA_DIR):
        shutil.copytree(DATA_DIR, DATA_BACKUP_DIR)


def restore_from_backup():
    """Restore data/ from data-backup/ (overwrites current data)."""
    if not os.path.exists(DATA_BACKUP_DIR):
        return
    for name in os.listdir(DATA_BACKUP_DIR):
        src = os.path.join(DATA_BACKUP_DIR, name)
        dst = os.path.join(DATA_DIR, name)
        if os.path.isfile(src):
            shutil.copy2(src, dst)


def clear_backup():
    """Remove the backup directory."""
    if os.path.exists(DATA_BACKUP_DIR):
        shutil.rmtree(DATA_BACKUP_DIR)


def detect_data_changes():
    """
    Compute hashes of data files and detect changes vs previous state.
    Returns (current_state, changes).
    """
    prev_state = load_data_state()
    current_state = {"sources": {}, "last_check": datetime.now().isoformat()}
    changes = []

    for key, filename in DATA_FILES.items():
        path = os.path.join(DATA_DIR, filename)
        if not os.path.exists(path):
            current_state["sources"][key] = {"exists": False}
            continue

        content_hash = get_file_hash(path)
        current_state["sources"][key] = {
            "exists": True,
            "content_hash": content_hash,
            "file": filename,
        }

        prev_source = prev_state.get("sources", {}).get(key, {})
        if prev_source.get("content_hash") and prev_source["content_hash"] != content_hash:
            changes.append({
                "source": SOURCE_NAMES.get(key, key),
                "type": "Data content changed",
                "details": f"File {filename} has been modified",
                "file": filename,
            })

    return current_state, changes


def fetch_socrata_api():
    """
    Fetch Michigan 90th Percentile data via SODA2 API.
    Returns list of records. Raises on HTTP error.
    """
    url = "https://data.michigan.gov/resource/39ya-9txc.json"
    count_url = f"{url}?$select=count(*)"
    count_resp = requests.get(count_url, timeout=30)
    count_resp.raise_for_status()
    count_data = count_resp.json()
    record_count = int(count_data[0]["count"]) if count_data else 0

    all_url = f"{url}?$limit={record_count}"
    all_resp = requests.get(all_url, timeout=30)
    all_resp.raise_for_status()
    return all_resp.json()


def _is_xlsx_href(href):
    """Check if href points to an xlsx file (ignoring query params like ?rev=...)."""
    path = urlparse(href).path
    return path.lower().endswith(".xlsx")


def _extract_xlsx_links(html: str, page_url: str) -> list[str]:
    """
    Extract xlsx links from HTML. Tries BeautifulSoup first, falls back to regex
    for edge cases (e.g. links in script/JSON or malformed markup).
    """
    soup = BeautifulSoup(html, "html.parser")
    xlsx_links = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if _is_xlsx_href(href) and href not in seen:
            xlsx_links.append(href)
            seen.add(href)

    if not xlsx_links:
        # Fallback: regex for href="...xlsx..." in case link is in odd markup
        for m in re.finditer(r'href=["\']([^"\']*\.xlsx[^"\']*)["\']', html, re.I):
            href = m.group(1).strip()
            if _is_xlsx_href(href) and href not in seen:
                xlsx_links.append(href)
                seen.add(href)

    return xlsx_links


# Browser-like headers to avoid 403 from bot protection on michigan.gov
# Note: Use gzip, deflate only (not br/Brotli) - requests doesn't decompress Brotli by default
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


def fetch_dsmi_inventories():
    """
    Fetch DSMI Inventories file.
    Visits the DSMI page and finds the xlsx link, then fetches it.
    Requires exactly one xlsx link; raises if none or multiple found.
    Raises on HTTP error or if no xlsx link found.
    """
    page_url = "https://www.michigan.gov/egle/about/organization/drinking-water-and-environmental-health/community-water-supply/lead-and-copper-rule/dsmi-inventories"
    page_resp = requests.get(page_url, headers=BROWSER_HEADERS, timeout=30)
    page_resp.raise_for_status()

    xlsx_links = _extract_xlsx_links(page_resp.text, page_url)

    if not xlsx_links:
        raise ValueError("No xlsx file link found on DSMI inventories page")

    if len(xlsx_links) > 1:
        raise ValueError(
            f"Multiple xlsx links found on DSMI inventories page ({len(xlsx_links)}), skipping fetch: {xlsx_links}"
        )

    xlsx_url = urljoin(page_url, xlsx_links[0])
    response = requests.get(xlsx_url, headers=BROWSER_HEADERS, timeout=30)
    response.raise_for_status()
    path = os.path.join(DATA_DIR, "DSMI-Service-Line-Materials-Estimates.xlsx")
    with open(path, "wb") as f:
        f.write(response.content)


def fetch_lead_copper_rule():
    """
    Fetch Lead & Copper Rule data file.
    Visits the LSLR page and finds the xlsx link, then fetches it.
    Requires exactly one xlsx link; raises if none or multiple found.
    Raises on HTTP error.
    """
    page_url = "https://www.michigan.gov/egle/about/organization/drinking-water-and-environmental-health/community-water-supply/lead-and-copper-rule/lslr-progress"
    page_resp = requests.get(page_url, headers=BROWSER_HEADERS, timeout=30)
    page_resp.raise_for_status()

    xlsx_links = _extract_xlsx_links(page_resp.text, page_url)

    if not xlsx_links:
        raise ValueError("No xlsx file link found on LSLR progress page")

    if len(xlsx_links) > 1:
        raise ValueError(
            f"Multiple xlsx links found on LSLR progress page ({len(xlsx_links)}), skipping fetch: {xlsx_links}"
        )

    xlsx_url = urljoin(page_url, xlsx_links[0])
    response = requests.get(xlsx_url, headers=BROWSER_HEADERS, timeout=30)
    response.raise_for_status()
    path = os.path.join(DATA_DIR, "2024-2025-LSLR-Data.xlsx")
    with open(path, "wb") as f:
        f.write(response.content)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    # Backup existing data before any fetches
    print("Backing up existing data...")
    backup_data()

    fetch_errors = []

    # 1. Fetch Socrata API
    try:
        print("[1/3] Fetching Socrata API (90th Percentile data)...")
        socrata_data = fetch_socrata_api()
        print(f"Fetched {len(socrata_data)} records")
        socrata_path = os.path.join(DATA_DIR, DATA_FILES["socrata_90th"])
        with open(socrata_path, "w") as f:
            json.dump(socrata_data, f, indent=2)
    except (requests.RequestException, json.JSONDecodeError) as e:
        print(f"  ✗ Failed: {e}")
        fetch_errors.append({"source": "socrata_90th", "name": SOURCE_NAMES["socrata_90th"], "error": str(e)})

    # 2. Fetch DSMI Inventories
    try:
        print("[2/3] Fetching DSMI Inventories...")
        fetch_dsmi_inventories()
    except (requests.RequestException, json.JSONDecodeError, ValueError) as e:
        print(f"  ✗ Failed: {e}")
        fetch_errors.append({"source": "dsmi", "name": SOURCE_NAMES["dsmi"], "error": str(e)})

    # 3. Fetch Lead & Copper Rule
    try:
        print("[3/3] Fetching Lead & Copper Rule...")
        fetch_lead_copper_rule()
    except (requests.RequestException, json.JSONDecodeError, ValueError) as e:
        print(f"  ✗ Failed: {e}")
        fetch_errors.append({"source": "lslr", "name": SOURCE_NAMES["lslr"], "error": str(e)})

    # On any fetch failure: restore from backup so data stays consistent
    if fetch_errors:
        print("\nRestoring from backup (some fetches failed)...")
        restore_from_backup()
        print("Backup kept at data-backup/")

    # Detect changes and save state
    print("\nChecking for data changes...")
    current_state, changes = detect_data_changes()
    current_state["changes"] = changes
    current_state["changes_count"] = len(changes)
    current_state["fetch_success"] = len(fetch_errors) == 0
    current_state["fetch_errors"] = fetch_errors
    save_data_state(current_state)

    if fetch_errors:
        print(f"\n✗ FETCH FAILURES: {len(fetch_errors)} source(s) failed")
        for err in fetch_errors:
            print(f"  - {err['name']}: {err['error']}")

    if changes:
        print(f"\n🚨 CHANGES DETECTED: {len(changes)} update(s) found!")
        for i, change in enumerate(changes, 1):
            print(f"  [{i}] {change['source']}: {change['details']}")
        if not fetch_errors:
            print("Backup kept at data-backup/")
    else:
        print("✓ No changes detected. All data sources unchanged.")
        if not fetch_errors:
            clear_backup()
            print("Backup cleared.")

    if fetch_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()