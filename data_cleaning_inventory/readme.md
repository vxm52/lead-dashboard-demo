# Michigan Lead Data – Replacement and Inventory Pipeline

This document describes the data cleaning and preparation workflow for the **Lead Service Line Replacement** dataset and the **Lead Service Line Inventory** dataset. It is written for teammates implementing automation and assumes no prior knowledge of the notebook.

---

## 1. Purpose

This pipeline processes two Michigan lead-related datasets:

1. **Replacement data**
   - Tracks how many lead and GPCL service lines were replaced by system and year.

2. **Inventory data**
   - Tracks the current service line inventory by system:
     - lead lines
     - galvanized previously connected to lead (GPCL) lines
     - non-lead lines
     - unknown lines
     - total lines

The pipeline produces outputs for two different purposes:

- **Client-facing / review version**
  - Preserve original missingness
  - Do not calculate missing pipeline counts
  - Keep reported values as-is
  - Only add helper flags for review

- **Visualization / internal version**
  - Allows limited calculation for charting and data summaries
  - Used internally for plots and dashboard preparation

---

## 2. Input Files

### Replacement data
**File:** `2024-2025-LSLR-Data.xlsx`  
**Header row used:** row index 2

### Inventory data
**File:** `DSMI-Service-Line-Materials-Estimates.xlsx`  
**Header row used:** row index 2

---

## 3. Key Principles

### 3.1 Preserve reported data
The client requested that if a value is missing in the original inventory data, it should remain missing in the client-facing cleaned version.

This means:

- Do **not** calculate `unknown_lines` just because it can be inferred
- Do **not** calculate `total_lines` just because component values exist
- Do **not** overwrite missing original values

### 3.2 Separate “review data” from “plotting data”
The pipeline intentionally keeps two versions when needed:

- **Client/review version**
  - original missingness preserved

- **Internal plotting version**
  - may include derived totals for visualization only

### 3.3 Aggregate only when justified
For replacement data, aggregation is intentional because duplicate `(pwsid, year)` records correspond to multiple entries that should be summed.

For inventory data, aggregation is **not** performed because each `pwsid` is already unique.

---

## 4. Replacement Data Pipeline

---

## 4.1 Goal

Prepare a yearly replacement table keyed by water system ID and year.

The final output should answer:

> For each `pwsid` and year, how many lead / GPCL service lines were replaced?

---

## 4.2 Raw structure

The raw replacement file contains these relevant fields:

- Public Water Supply ID
- Supply Name
- County
- Year
- Number of Lead and GPCL Service Lines Replaced

These are renamed to:

- `pwsid`
- `supply_name`
- `county`
- `year`
- `lines_replaced`

---

## 4.3 Initial validation

The notebook checks:

- row count
- duplicate `pwsid`
- duplicate `(pwsid, year)`
- distribution of `lines_replaced`
- unique years present

The observed years are:

- 2021
- 2022
- 2023
- 2024

---

## 4.4 Duplicate handling

The key finding is:

- `pwsid` alone is **not** unique
- `(pwsid, year)` has a small number of duplicates

Inspection showed that duplicate `(pwsid, year)` records can happen because the same water system appears with slightly different `supply_name` values in the same year.

Example pattern:

- same `pwsid`
- same `year`
- same county
- different `supply_name`
- different `lines_replaced`

The chosen handling rule is:

### Aggregate by:
- `pwsid`
- `year`
- `county`

### Aggregate field:
- `lines_replaced` → sum

This preserves yearly replacement totals without depending on unstable `supply_name` formatting.

---

## 4.5 Why county is retained

The replacement pipeline keeps county information as a checking field, renamed to:

- `county_for_checking`

This field is not the primary merge key.  
It is retained to support validation later when merging with other datasets.

---

## 4.6 Replacement output

Final output columns:

- `pwsid`
- `year`
- `county_for_checking`
- `lines_replaced`

**Output file:**
- `clean_LSLR.csv`

---

## 4.7 Replacement pipeline summary

### Input
`2024-2025-LSLR-Data.xlsx`

### Transformations
1. Read file
2. Rename relevant columns
3. Check duplicates on `(pwsid, year)`
4. Group by `(pwsid, year, county)`
5. Sum `lines_replaced`
6. Rename `county` to `county_for_checking`

### Output
`clean_LSLR.csv`

---

## 5. Inventory Data Pipeline

---

## 5.1 Goal

Prepare two inventory datasets:

1. **Client/review version**
   - preserve missing original values
   - add flags for completeness and mismatch
   - do not calculate missing pipelines

2. **Internal visualization version**
   - used for plotting
   - allows limited derived values for convenience

---

## 5.2 Raw structure

The raw inventory file contains these relevant fields:

- Public Water Supply ID
- Supply Name
- Lead
- Galvanized Previously Connected to Lead
- Non-Lead
- Lead Status Unknown
- Total Service Lines

These are renamed to:

- `pwsid`
- `supply_name`
- `lead_lines`
- `gpcl_lines`
- `non_lead_lines`
- `unknown_lines`
- `total_lines`

---

## 5.3 Uniqueness

The notebook confirms:

- `pwsid` is unique in the inventory dataset

So no grouping or aggregation is required.

---

## 5.4 Missingness and special values

The inventory dataset contains:

- regular missing values (`NaN`)
- string values like `Not Received`

These appear especially in the numeric columns, for example `lead_lines`.

### Required handling
Before any numeric checks or calculations:

- treat `Not Received` as missing
- convert numeric columns to numeric dtype
- coerce non-numeric values to missing

The numeric columns are:

- `lead_lines`
- `gpcl_lines`
- `non_lead_lines`
- `unknown_lines`
- `total_lines`

---

## 5.5 Client-facing inventory version

### Objective
Create a cleaned inventory table for client review while preserving original data integrity.

### Rule
If a value is missing in the original inventory data, it should stay missing.

This means the client version must **not**:

- fill in `unknown_lines`
- fill in `total_lines`
- back-calculate missing pipeline counts

### Allowed helper columns
The client version may add review fields, because they do not overwrite original reported data:

- `calc_total`
- `inventory_status`
- `total_mismatch`

---

## 5.6 Meaning of helper columns

### `calc_total`
A derived checking field:

`lead_lines + gpcl_lines + non_lead_lines + unknown_lines`

Important:
- this is only for comparison / review
- it does **not** replace `total_lines`

### `inventory_status`
A completeness flag:

- `complete` → no missing values among line count columns
- `incomplete` → at least one missing value among:
  - `lead_lines`
  - `gpcl_lines`
  - `non_lead_lines`
  - `unknown_lines`
  - `total_lines`

### `total_mismatch`
A consistency flag:

- `True` if the reported `total_lines` does not match `calc_total`
- `False` otherwise

Important:
- This comparison should only be made when all component fields and `total_lines` are present
- Missing totals should **not** automatically be labeled mismatch just because they are missing

---

## 5.7 Client-facing inventory output

The client version should preserve:

- original `lead_lines`
- original `gpcl_lines`
- original `non_lead_lines`
- original `unknown_lines`
- original `total_lines`

and add:

- `calc_total`
- `inventory_status`
- `total_mismatch`

**Output file:**
- `clean_inventory_without_calculation.csv`

This is the version that should be shared for review / auditing / merge checks.

---

## 5.8 Internal plotting version

### Objective
Keep a second version for internal visualization where limited calculations are acceptable.

This version is based on the original inventory table after numeric conversion, but it may:

- fill missing `unknown_lines` when inferable from total
- fill missing `total_lines` when all components exist
- use helper totals for plotting
- mark completeness and mismatch for internal use

### Important boundary
This plotting version is **not** the same as the client version and should not overwrite it.

---

## 5.9 Internal plotting logic used in the notebook

The notebook performs the following checks and adjustments:

### A. Identify missing inventory rows
Rows with any missing value among:
- `lead_lines`
- `gpcl_lines`
- `non_lead_lines`
- `unknown_lines`
- `total_lines`

### B. Investigate text values like `Not Received`
These are found in numeric columns and must be converted to missing before numeric processing.

### C. Compute `calc_total`
Used to compare reported totals against the sum of components.

### D. Fill missing `unknown_lines` in some cases
When:
- `unknown_lines` is missing
- `total_lines` is present

the notebook infers unknown lines as:

`total_lines - lead_lines - gpcl_lines - non_lead_lines`

This step is acceptable for **plotting only**, not for client review.

### E. Fill missing `total_lines` in some cases
When:
- `total_lines` is missing
- all component line counts are present

the notebook infers:

`total_lines = lead_lines + gpcl_lines + non_lead_lines + unknown_lines`

Again, this is for **internal plotting only**.

### F. Detect remaining mismatches
After limited internal calculation, the notebook still identifies rows where:

`calc_total != total_lines`

These rows are flagged with:
- `total_mismatch`

### G. Label complete / incomplete
The plotting version still uses:
- `inventory_status = complete`
- `inventory_status = incomplete`

depending on whether any line-count columns remain missing.

---

## 5.10 Internal plotting output

The notebook currently exports:

- `clean_inventory.csv`

This is the **internal cleaned/plotting version**, not the client-preserved version.

---

## 6. Output Files

### Replacement
- `clean_LSLR.csv`

### Inventory – client/review version
- `clean_inventory_without_calculation.csv`

### Inventory – plotting/internal version
- `clean_inventory.csv`

---

## 7. Join Logic Across Datasets

### Main join field
All three major datasets use:

- `pwsid`

### Additional fields kept for validation
- replacement data keeps `county_for_checking`
- inventory retains `supply_name`
- history retains `system_name` and `county`

These are not always stable enough to be primary merge keys, but they are useful for QA.

---

## 8. Known Issues

### Replacement data
- Same `pwsid` and year may appear with multiple `supply_name` values
- These must be summed rather than treated as distinct systems

### Inventory data
- Some numeric fields contain text values such as `Not Received`
- Some systems have incomplete inventory counts
- Some reported totals do not match component sums
- Missingness is meaningful and should not always be corrected

---

## 9. Recommended Automation Structure

Automation should treat the pipeline as three separate outputs:

### A. Replacement pipeline
1. Read file
2. Rename columns
3. Validate duplicates on `(pwsid, year)`
4. Group by `(pwsid, year, county)`
5. Sum `lines_replaced`
6. Rename county checking field
7. Export `clean_LSLR.csv`

### B. Inventory client pipeline
1. Read file
2. Rename columns
3. Standardize special text values like `Not Received`
4. Convert numeric columns
5. Copy into client version
6. Compute `calc_total` for checking only
7. Assign `inventory_status`
8. Assign `total_mismatch`
9. Do **not** fill missing original values
10. Export `clean_inventory_without_calculation.csv`

### C. Inventory plotting pipeline
1. Start from numeric-cleaned inventory
2. Create plotting version
3. Optionally infer missing `unknown_lines`
4. Optionally infer missing `total_lines`
5. Recompute `calc_total`
6. Mark `total_mismatch`
7. Mark `inventory_status`
8. Export `clean_inventory.csv`

---

## 10. Key Philosophy

> Preserve original reported inventory values for clients,  
> but allow a separate derived version for internal visualization.

This distinction is essential for automation and must not be collapsed into a single output.

---

## 11. Final Notes for Teammates Implementing Automation

- Do not mix client-facing and plotting logic into one dataset
- Keep the replacement and inventory pipelines separate
- Treat `Not Received` as missing before numeric conversion
- Use `pwsid` as the main merge key
- Keep validation fields like county and supply name for QA
- Preserve auditability: every derived field should be clearly labeled as derived

---
