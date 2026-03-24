# Michigan Lead Data – Trend Analysis Merge Pipeline

This document describes the analysis pipeline that combines the cleaned **history**, **replacement**, and **inventory** datasets for trend analysis and visualization.

It is intended for teammates implementing automation or reproducing the analysis workflow.

---

## 1. Purpose

This pipeline attempts to combine three cleaned datasets:

- `lead_90th_history_cleaned.csv`
- `clean_LSLR.csv`
- `clean_inventory.csv`

The goal is to support trend analysis across:

- historical lead 90th percentile values
- yearly replacement activity
- current inventory status

---

## 2. Input Files

### History
**File:** `lead_90th_history_cleaned.csv`

Expected columns:
- `pwsid`
- `system_name`
- `county`
- `population`
- `monitoring_end_date`
- `lead_90th_ppb`
- `includes_5th_liter_or_not`
- `sampling_next_due_subject_to_change`
- `year`
- `month`

### Replacement
**File:** `clean_LSLR.csv`

Expected columns:
- `pwsid`
- `year`
- `county_for_checking`
- `lines_replaced`

### Inventory
**File:** `clean_inventory.csv`

Expected columns:
- `pwsid`
- `supply_name`
- `lead_lines`
- `gpcl_lines`
- `non_lead_lines`
- `unknown_lines`
- `total_lines`
- `calc_total`
- `total_mismatch`
- `inventory_status`

---

## 3. Analysis Goal

The intended downstream analysis is to connect:

- yearly lead history
- yearly replacement counts
- service line inventory context

This is mainly for:
- trend plots
- exploration
- dashboard prototyping

---

## 4. Initial Data Preparation

After loading the three cleaned datasets:

### 4.1 Add year to inventory
The notebook assigns:

- `inventory["year"] = 2025`

This is because the inventory dataset is treated as a 2025 snapshot rather than a multi-year historical table.

### 4.2 Inspect column structure
The notebook prints column names to confirm the schemas are as expected before merging.

---

## 5. History + Replacement Merge

---

## 5.1 Merge logic

The first major merge is:

- left table: history
- right table: replacement
- keys: `pwsid`, `year`
- join type: left join

This produces `trend_df`.

---

## 5.2 Why this merge is valid

This merge is appropriate because:

- history has many rows across years
- replacement is already aggregated by:
  - `pwsid`
  - `year`

The replacement table is therefore compatible with history at the yearly level.

---

## 5.3 Important behavior

The row count of `trend_df` stays the same as history because the merge is a left join.

This means:
- every history row is preserved
- `lines_replaced` is filled only when a matching replacement record exists
- unmatched rows remain with missing `lines_replaced`

---

## 5.4 Why many rows have missing replacement values

This is expected.

Main reasons:

1. **Replacement data only covers 2021–2024**
2. **History covers a much larger time range**
   - 2015–2026
3. Not every water system appears in the replacement dataset
4. History may contain duplicate `(pwsid, year)` combinations because multiple monitoring records can exist within the same year

As a result, many history rows do not find a matching replacement record.

---

## 5.5 Observed result

The notebook shows:

- only a subset of rows have non-missing `lines_replaced`
- most rows remain missing after the merge

This is normal and does **not** indicate a failed merge.

It mainly reflects coverage differences between the datasets.

---

## 6. Duplicate Checks Before Merge

The notebook checks duplicates on:

- history: `(pwsid, year)`
- replacement: `(pwsid, year)`
- inventory: `(pwsid, year)`

### Findings

#### History
History contains many duplicate `(pwsid, year)` combinations.

This is expected because a system may have:
- multiple monitoring dates
- multiple records in the same year
- multiple sub-system names

#### Replacement
Replacement has no duplicate `(pwsid, year)` combinations after cleaning.

This is expected because it was already aggregated in the cleaning pipeline.

#### Inventory
Inventory also has no duplicate `(pwsid, year)` combinations because:
- `pwsid` is unique
- year is artificially assigned as 2025 for the full inventory snapshot

---

## 7. Inventory Merge Checks

The notebook then tests whether inventory can be merged with:

- replacement
- history

using:
- `pwsid`
- `year`

---

## 7.1 Inventory + Replacement check

The check shows:

- no matching records between inventory and replacement on `(pwsid, year)`

### Why

Because:

- inventory year is set to **2025**
- replacement years are only:
  - 2021
  - 2022
  - 2023
  - 2024

So there is no overlap in `year`.

### Conclusion

A direct merge between inventory and replacement on `(pwsid, year)` is not meaningful under the current design.

---

## 7.2 Inventory + History check

The initial merge check also fails to match most rows.

After investigation, the notebook finds that:

- `pwsid` values contain whitespace inconsistencies
- stripping whitespace improves matching

After trimming whitespace:
- only a very small number of inventory rows match history on `(pwsid, year)`

### Why only a few rows match

Because inventory is treated as a **2025 snapshot**, while history:

- contains many years from 2015 onward
- has very sparse 2025 coverage

Therefore even after fixing whitespace, overlap remains very small.

---

## 8. Key Interpretation of Inventory

The inventory dataset should **not** be treated as a yearly historical dataset.

It is better interpreted as:

> a single point-in-time snapshot of system service line conditions

So it should usually be joined by:

- `pwsid` only

rather than:
- `pwsid` + `year`

unless the project later receives true multi-year inventory files.

---

## 9. Type and Formatting Standardization

The notebook checks data types for `pwsid` in all three datasets.

All are stored as string-like object dtype, but the merge investigation reveals whitespace inconsistencies.

### Required normalization before merge
All datasets should standardize `pwsid` by:
- treating it as string
- trimming leading and trailing spaces

This is especially important for automation.

---

## 10. Year Standardization

The notebook also converts:

- `trend_df["year"]` to integer

This is useful because after merge it may still be stored as float due to earlier missingness / CSV loading behavior.

### Recommendation
All merge keys should be standardized before merge:
- `pwsid` → stripped string
- `year` → integer where appropriate

---

## 11. Analysis Window Used

For lead trend summary, the notebook filters to:

- years 2017 through 2024

This creates `analysis_df`.

### Why this range is used
Because:
- very early years have limited data
- 2025–2026 are sparse or incomplete
- 2017–2024 provides a more stable analysis range

---

## 12. Example Trend Summary Produced

The notebook computes a yearly average of:

- `lead_90th_ppb`

grouped by year for the selected analysis window.

This is a simple descriptive summary and can be used for:
- line charts
- yearly trend reporting
- rough exploratory comparisons

---

## 13. What This Pipeline Currently Does Well

### 13.1 Valid use case
History + replacement merge is appropriate for:
- yearly trend analysis
- adding replacement context to historical lead records

### 13.2 Useful validations
The notebook correctly surfaces:
- duplicate structure differences
- poor inventory overlap
- key standardization issues
- coverage mismatch across datasets

---

## 14. Current Limitations

### 14.1 Inventory cannot be meaningfully merged by year
Because inventory is assigned year 2025 as a snapshot, joining on `(pwsid, year)` produces almost no overlap.

### 14.2 History has repeated `(pwsid, year)` rows
This means merges at yearly level may still create repeated replacement values across multiple history records in the same year.

This is not wrong, but it must be understood during interpretation.

### 14.3 Replacement is sparse relative to history
Many history rows will naturally have no replacement value.

### 14.4 Snapshot vs. longitudinal mismatch
Inventory is a snapshot dataset, while history and replacement are time-series datasets.

These should not be treated as equivalent structures.

---

## 15. Recommended Merge Strategy Going Forward

### A. History + Replacement
Use:
- keys: `pwsid`, `year`
- join type: left join from history

This is the correct main trend merge.

### B. Inventory with time-series data
Do **not** merge inventory on `(pwsid, year)` unless future inventory data includes true yearly records.

Instead, use inventory as:
- a separate reference table by `pwsid`
- or merge by `pwsid` only when system-level context is needed

### C. Standardize keys first
Before any automated merge:
- strip whitespace from `pwsid`
- standardize `year` type
- confirm no accidental hidden spaces remain

---

## 16. Recommended Automation Workflow

### Step 1
Load:
- history
- replacement
- inventory

### Step 2
Standardize keys:
- `pwsid` → string + strip whitespace
- `year` → integer if applicable

### Step 3
Create `trend_df`
- merge history with replacement on `(pwsid, year)`

### Step 4
Create optional filtered analysis subset
- e.g. 2017–2024

### Step 5
Generate trend summaries
Examples:
- yearly mean lead value
- yearly counts of matched replacement rows
- yearly missing replacement counts

### Step 6
Treat inventory separately
- use as system-level snapshot
- join by `pwsid` only if needed for reference context

---

## 17. Recommended Output Objects

### Primary merged table
- `trend_df`
- history enriched with yearly replacement information

### Optional filtered analysis table
- `analysis_df`
- subset of `trend_df` for selected years

### Optional yearly summaries
Examples:
- average lead level by year
- missing replacement counts by year
- matched replacement counts by year

---

## 18. Key Takeaway

This notebook shows that the data structure is:

- **history** = longitudinal
- **replacement** = longitudinal
- **inventory** = snapshot

So the main automated analysis pipeline should be built around:

> history + replacement

And inventory should be treated as a separate contextual dataset unless a different merge design is explicitly chosen.

---

## 19. Final Notes for Teammates

- A failed inventory-by-year merge is expected, not a bug
- Missing `lines_replaced` after the history merge is expected
- Always clean `pwsid` before merging
- Do not assume all datasets share the same temporal structure
- Build analysis logic around the actual data-generating process, not just shared column names

---
