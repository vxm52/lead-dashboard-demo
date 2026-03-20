"""
Merge DSMI and LSLR data on PWSID and produce output in lead-data.csv format.

Follow-up to fetch_data.py. Reads DSMI, LSLR, and socrata JSON from data/,
merges on Public Water Supply ID (PWSID), and outputs lead-data.csv.

Logic (per methodology):
1. Merge using PWSID, keep all records (outer join).
2. Total to identify/replace = Lead + GPCL + Unknown.
3. Screen for incomplete inventory (blank fields preventing progress calculation).
4. Exceedance: merged from optional lookup or preserved from existing file.
5. % Replaced = (Lines Replaced ÷ (Total to Identify+Replace + Lines Replaced)) × 100.
"""

import json
import os

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

DSMI_FILE = "DSMI-Service-Line-Materials-Estimates.xlsx"
LSLR_FILE = "2024-2025-LSLR-Data.xlsx"
SOCRATA_FILE = "socrata-90th-percentile.json"
OUTPUT_CSV = "lead-data-test.csv"

HEADER_ROW = 2

OUTPUT_COLUMNS = [
    "PWSID", "Supply Name", "Population", "2021", "2022", "2023", "2024",
    "Total Replaced", "Lead Lines", "GPCL", "Unknown", "Total To Replace",
    "Percent Replaced", "Non-Lead", "Total Lines", "Exceedance", "Latitude",
    "Longitude", "EPA_Link", "Status Explanation", "Status",
]


def _num(val):
    """Parse to int; 0 for blank/NaN."""
    if pd.isna(val) or val is None or str(val).strip() in ("", "-"):
        return 0
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def _fmt_num(val):
    """Format as comma-separated int; empty for 0/blank."""
    n = _num(val)
    return "" if n == 0 else f"{n:,}"


def load_dsmi(path: str) -> pd.DataFrame:
    df = pd.read_excel(path, header=HEADER_ROW)
    df["Public Water Supply ID"] = df["Public Water Supply ID"].astype(str).str.strip()
    rename = {
        "Lead": "Lead Lines",
        "Galvanized Previously Connected to Lead": "GPCL",
        "Lead Status Unknown": "Unknown",
        "Total Service Lines": "Total Lines",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    df["Supply Name"] = df.get("Supply Name", pd.Series(dtype=object)).fillna("")
    return df


def load_lslr(path: str) -> pd.DataFrame:
    df = pd.read_excel(path, header=HEADER_ROW)
    df["Public Water Supply ID"] = df["Public Water Supply ID"].astype(str).str.strip()
    key_col = "Public Water Supply ID"
    year_col = "Year"
    repl_col = "Number of Lead and GPCL Service Lines Replaced"
    df[repl_col] = pd.to_numeric(df[repl_col], errors="coerce").fillna(0)
    pivoted = df.pivot_table(
        index=key_col, columns=year_col, values=repl_col, aggfunc="sum"
    ).reset_index()
    for y in [2021, 2022, 2023, 2024]:
        if y not in pivoted.columns:
            pivoted[y] = 0
    pivoted["Total Replaced"] = (
        pivoted[2021].fillna(0) + pivoted[2022].fillna(0) +
        pivoted[2023].fillna(0) + pivoted[2024].fillna(0)
    )
    pivoted = pivoted.rename(columns={y: str(y) for y in [2021, 2022, 2023, 2024]})
    return pivoted


def load_socrata(path: str) -> pd.DataFrame:
    with open(path) as f:
        data = json.load(f)
    rows = []
    for r in data:
        pwsid = (r.get("public_water_supply_id") or "").strip()
        if pwsid:
            pop = r.get("population")
            pop_val = _num(pop) if pop is not None else None
            rows.append({"Public Water Supply ID": pwsid, "Population": pop_val})
    df = pd.DataFrame(rows)
    return df.drop_duplicates(subset=["Public Water Supply ID"], keep="first")


def merge_sources(dsmi: pd.DataFrame, lslr: pd.DataFrame, socrata: pd.DataFrame) -> pd.DataFrame:
    merged = dsmi.merge(lslr, on="Public Water Supply ID", how="outer")
    merged = merged.merge(socrata, on="Public Water Supply ID", how="left")
    return merged


def _inventory_complete(row) -> bool:
    """True if we can compute Total To Replace = Lead + GPCL + Unknown."""
    lead, gpcl, unknown = row.get("Lead Lines"), row.get("GPCL"), row.get("Unknown")
    has_any = any(not pd.isna(v) and str(v).strip() not in ("", "-") for v in (lead, gpcl, unknown))
    if has_any:
        return True
    # All blank: complete if Non-Lead == Total Lines (no lead)
    nl, tl = _num(row.get("Non-Lead")), _num(row.get("Total Lines"))
    return tl > 0 and nl == tl


def _pct_replaced(replaced: int, to_replace: int) -> str:
    denom = to_replace + replaced
    if denom == 0:
        return ""  # Match lead-data.csv: empty when both 0
    pct = min(100, max(0, (replaced / denom) * 100))
    return f"{int(round(pct))}%"


def _status(row_data: dict) -> tuple[str, str]:
    inv_complete = row_data["inventory_complete"]
    to_replace = row_data["total_to_replace"]
    replaced = row_data["total_replaced"]
    y21, y22, y23, y24 = row_data["y2021"], row_data["y2022"], row_data["y2023"], row_data["y2024"]

    if not inv_complete:
        return "Inventory not received or data not complete", "Inventory not received or incomplete"
    if to_replace == 0:
        if replaced > 0:
            return "100% replaced", "100% replaced"
        return " Inventory completed, no lead lines identified ", "No lead lines"
    if replaced >= to_replace:
        return "100% replaced", "100% replaced"

    avg = (y21 + y22 + y23 + y24) / 4
    pct_annual = (avg / to_replace) * 100 if to_replace else 0
    pct_replaced = (replaced / (to_replace + replaced)) * 100 if (to_replace + replaced) else 0
    if pct_annual >= 20 or pct_replaced >= 20:
        return "Compliant (≥20% average replacement, 2021–2024)", "Compliant"
    return " Not Compliant (<20% average replacement, 2021–2024) ", "Not compliant"


def build_output(merged: pd.DataFrame) -> pd.DataFrame:
    key = "Public Water Supply ID"
    rows = []
    for _, row in merged.iterrows():
        pwsid = str(row.get(key, "")).strip()
        if not pwsid:
            continue

        supply_name = (
            row.get("Supply Name_x") or row.get("Supply Name_y") or row.get("Supply Name") or ""
        )
        if pd.isna(supply_name):
            supply_name = ""
        supply_name = str(supply_name).strip()

        lead, gpcl, unknown = row.get("Lead Lines"), row.get("GPCL"), row.get("Unknown")
        inv_complete = _inventory_complete(row)
        total_to_replace = (
            _num(lead) + _num(gpcl) + _num(unknown) if inv_complete else 0
        )

        y21 = _num(row.get("2021"))
        y22 = _num(row.get("2022"))
        y23 = _num(row.get("2023"))
        y24 = _num(row.get("2024"))
        total_replaced = _num(row.get("Total Replaced"))
        if total_replaced == 0 and (y21 or y22 or y23 or y24):
            total_replaced = y21 + y22 + y23 + y24

        pct_str = _pct_replaced(total_replaced, total_to_replace)
        status_expl, status = _status({
            "inventory_complete": inv_complete,
            "total_to_replace": total_to_replace,
            "total_replaced": total_replaced,
            "y2021": y21, "y2022": y22, "y2023": y23, "y2024": y24,
        })

        pop = row.get("Population")
        pop_str = "" if pd.isna(pop) or pop is None else f"{_num(pop):,}"

        rows.append({
            "PWSID": pwsid,
            "Supply Name": supply_name,
            "Population": pop_str,
            "2021": "" if y21 == 0 else str(int(y21)),
            "2022": "" if y22 == 0 else str(int(y22)),
            "2023": "" if y23 == 0 else str(int(y23)),
            "2024": "" if y24 == 0 else str(int(y24)),
            "Total Replaced": "" if total_replaced == 0 else str(int(total_replaced)),
            "Lead Lines": "" if _num(lead) == 0 else _fmt_num(lead),
            "GPCL": "" if _num(gpcl) == 0 else _fmt_num(gpcl),
            "Unknown": "" if _num(unknown) == 0 else _fmt_num(unknown),
            "Total To Replace": "" if not inv_complete or total_to_replace == 0 else _fmt_num(total_to_replace),
            "Percent Replaced": pct_str,
            "Non-Lead": _fmt_num(row.get("Non-Lead")),
            "Total Lines": _fmt_num(row.get("Total Lines")),
            "Exceedance": "",
            "Latitude": "",
            "Longitude": "",
            "EPA_Link": f"https://echo.epa.gov/detailed-facility-report?fid={pwsid}&sys=SDWIS",
            "Status Explanation": status_expl,
            "Status": status,
        })
    return pd.DataFrame(rows, columns=OUTPUT_COLUMNS)


def main():
    dsmi_path = os.path.join(DATA_DIR, DSMI_FILE)
    lslr_path = os.path.join(DATA_DIR, LSLR_FILE)
    socrata_path = os.path.join(DATA_DIR, SOCRATA_FILE)
    output_path = os.path.join(DATA_DIR, OUTPUT_CSV)

    if not os.path.exists(dsmi_path):
        raise FileNotFoundError(f"DSMI not found: {dsmi_path}. Run fetch_data.py first.")
    if not os.path.exists(lslr_path):
        raise FileNotFoundError(f"LSLR not found: {lslr_path}. Run fetch_data.py first.")
    if not os.path.exists(socrata_path):
        raise FileNotFoundError(f"Socrata not found: {socrata_path}.")

    dsmi = load_dsmi(dsmi_path)
    lslr = load_lslr(lslr_path)
    socrata = load_socrata(socrata_path)

    merged = merge_sources(dsmi, lslr, socrata)
    out_df = build_output(merged).sort_values("PWSID").reset_index(drop=True)
    out_df.to_csv(output_path, index=False)
    print(f"Done. Output: {output_path}")


if __name__ == "__main__":
    main()
