"""
Merge DSMI and LSLR data on PWSID and produce output in lead-data.csv format.

Follow-up to fetch_data.py. Reads DSMI, LSLR, and socrata JSON from data/,
merges on Public Water Supply ID (PWSID), and outputs lead-data.csv.
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
    val = _num(val)
    if val == 0:
        return ""
    return str(int(val))


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


def _pct_replaced(replaced: int, to_replace: int) -> int | None:
    denom = to_replace + replaced
    if denom == 0:
        return None
    pct = (replaced / denom) * 100
    return int(round(pct))


def build_output(merged: pd.DataFrame) -> pd.DataFrame:
    key = "Public Water Supply ID"
    rows = []
    for _, row in merged.iterrows():
        pwsid = str(row.get(key, "")).strip()
        if not pwsid:
            continue

        supply_name = row.get("Supply Name", "").strip()
        population = _num(row.get("Population"))

        lead, gpcl, nonlead, unknown = row.get("Lead Lines"), row.get("GPCL"), row.get("Non-Lead"), row.get("Unknown")
        total = row.get("Total Lines")

        total_to_replace = _num(lead) + _num(gpcl) + _num(unknown)
        total_replaced = _num(row.get("Total Replaced"))
        percent_replaced = _pct_replaced(total_replaced, total_to_replace)

        if population == 0:
            status = "No service lines; wholesale only"
            status_expl = "No service lines; wholesale only"
        elif pd.isna(total):
            status = "Inventory not received or incomplete"
            status_expl = "Inventory not received or incomplete"
        else:
            if nonlead == total:
                if total_replaced > 0:
                    status = "100% replaced"
                    status_expl = "100% replaced"
                else:
                    status = "No lead lines"
                    status_expl = "Inventory completed, no lead lines identified"
            else:
                if percent_replaced is not None:
                    if percent_replaced < 20:
                        status = "Not compliant"
                        status_expl = "Not Compliant (<20% average replacement, 2021–2024)"
                    else:
                        status = "Compliant"
                        status_expl = "Compliant (≥20% average replacement, 2021–2024)"
                else:
                    status = "Inventory not received or incomplete"
                    status_expl = "Inventory not received or incomplete"

        y21 = _num(row.get("2021"))
        y22 = _num(row.get("2022"))
        y23 = _num(row.get("2023"))
        y24 = _num(row.get("2024"))

        rows.append({
            "PWSID": pwsid,
            "Supply Name": supply_name,
            "Population": "" if population == 0 else str(int(population)),
            "2021": _fmt_num(y21),
            "2022": _fmt_num(y22),
            "2023": _fmt_num(y23),
            "2024": _fmt_num(y24),
            "Total Replaced": _fmt_num(total_replaced),
            "Lead Lines": _fmt_num(lead),
            "GPCL": _fmt_num(gpcl),
            "Unknown": _fmt_num(unknown),
            "Total To Replace": _fmt_num(total_to_replace),
            "Percent Replaced": f"{percent_replaced}%" if percent_replaced else "",
            "Non-Lead": _fmt_num(nonlead),
            "Total Lines": _fmt_num(total),
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
    merged.to_csv("merged.csv", index=False)
    out_df = build_output(merged).sort_values("PWSID").reset_index(drop=True)
    out_df.to_csv(output_path, index=False)
    print(f"Done. Output: {output_path}")


if __name__ == "__main__":
    main()
