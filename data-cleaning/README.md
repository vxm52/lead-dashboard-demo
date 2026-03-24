# Michigan Lead Data – History Data Pipeline (Clean + Deduplicate)

---

## 1. Purpose

This pipeline processes the Michigan Lead 90th Percentile dataset to:

- Clean raw historical data
- Standardize structure
- Preserve government-reported values
- Remove exact duplicates
- Identify conflicting records (same system & date but different values)

This dataset is used for:
- Visualization (dashboard)
- Future automation pipeline
- Data merging with replacement & inventory datasets

---

## 2. Input Data

**File:**
90th_percentiles_over_time.xlsx

**Sheet:**
2016_2025 Duplicates Removed

---

## 3. Key Principles

### ⚠️ 1. Do NOT fabricate data
- No filling missing values
- No estimation
- No aggregation unless explicitly stated

### ⚠️ 2. Preserve original records
- Government data is treated as source of truth
- Even inconsistent records are kept unless unusable

### ⚠️ 3. Only remove data when necessary
- Only drop rows that are unusable for analysis

---

## 4. Pipeline Overview
Raw Excel
↓
Column Filtering
↓
Column Cleaning
↓
Column Renaming
↓
Data Type Conversion
↓
Drop Invalid Rows
↓
Duplicate Removal
↓
Conflict Detection
↓
Final Clean Dataset

## 5. Data Cleaning Steps

### Step 1 — Keep Relevant Columns

The raw dataset contains thousands of empty columns due to Excel formatting.

We keep only the first 8 columns:
- Public Water Supply ID
- System Name
- County
- Population
- Monitoring Period End
- Lead 90th Percentile
- Includes 5th Liter
- Sampling Next Due

---

### Step 2 — Standardize Column Names

Transformations applied:
- Remove `\n`
- Trim whitespace
- Convert to lowercase
- Replace spaces with `_`
- Remove parentheses

---

### Step 3 — Rename Columns

| Original | New |
|--------|-----|
| Public Water Supply ID | pwsid |
| Lead 90th Percentile (ppb) | lead_90th_ppb |
| Last Monitoring Period End | monitoring_end_date |
| Includes 5th liter? | includes_5th_liter_or_not |

---

### Step 4 — Date Processing

- Convert `monitoring_end_date` to datetime
- Extract:
  - `year`
  - `month`

---

### Step 5 — Numeric Conversion

- Convert `lead_90th_ppb` to numeric
- Invalid values → NaN (no filling)

---

### Step 6 — Drop Invalid Rows

Rows are removed ONLY if missing:
- pwsid
- monitoring_end_date
- lead_90th_ppb

---

## 6. Duplicate Handling Strategy

### 6.1 Exact Duplicates

Definition:
Rows identical across all columns

Action:
- Removed

---

### 6.2 Logical Duplicates (IMPORTANT)

Definition:
Same:
- `pwsid`
- `monitoring_end_date`

But different:
- lead values
- system names

---

### 6.3 Conflict Detection

We identify cases where:
same (pwsid, monitoring_end_date)
→ multiple lead_90th_ppb values

This indicates:
- Data inconsistency
- Possibly multiple sampling sources

---

### 6.4 Conflict Analysis Metrics

For each (pwsid, monitoring_end_date):

- `lead_value_count` → number of unique lead values
- `system_name_count` → number of unique system names

---

### 6.5 Handling Decision

⚠️ We DO NOT resolve conflicts automatically

Reason:
- No authoritative rule to choose correct value
- Must preserve original reporting

👉 These records are flagged for review instead of removed

---

## 7. Additional Derived Field

### Action Level Indicator
above_action_level = lead_90th_ppb > 12
Notes:
- Uses 12 ppb (post-2025 rule)
- Can be adjusted if needed

---

## 8. Output Files

### 1. Cleaned Dataset
lead_90th_history_cleaned.csv

- Includes cleaned + formatted data
- May still contain logical duplicates

---

### 2. Deduplicated Dataset


lead_90th_history_no_duplicate.csv


- Exact duplicates removed
- Logical conflicts preserved

---

## 9. Output Schema

| Column | Description |
|------|------------|
| pwsid | Water system ID |
| system_name | System name |
| county | County |
| population | Population |
| monitoring_end_date | Monitoring date |
| lead_90th_ppb | Lead value |
| includes_5th_liter_or_not | Sampling type |
| sampling_next_due_subject_to_change | Next sampling |
| year | Year |
| month | Month |
| above_action_level | Boolean flag |

---

## 10. Known Issues

- Same system may appear with different names
- Same date may have multiple lead values
- Missing values are common and expected
- Data is not guaranteed to be consistent

---

## 11. For Automation Team

To reproduce pipeline:

1. Load Excel file
2. Select correct sheet
3. Keep first 8 columns
4. Clean column names
5. Rename columns
6. Convert date + extract year/month
7. Convert numeric fields
8. Drop invalid rows
9. Remove exact duplicates
10. Detect conflicts (do NOT resolve)
11. Add action level flag
12. Export CSV

---

## 12. Key Join Field


pwsid


Used to merge with:
- Replacement dataset
- Inventory dataset

---

## 13. Key Philosophy

> Preserve reality, not perfection.

- Do not "fix" the data
- Do not guess missing values
- Always prioritize traceability

---
