# Scripts and Data Update Workflow

This folder contains scripts used to fetch, merge, and convert Michigan lead service line data.

## What runs automatically

The GitHub Actions workflow at `.github/workflows/check-data-updates.yml` runs daily at `14:00 UTC` (9 AM EST / 10 AM EDT), and can also be started manually with `workflow_dispatch`.

Main flow:

1. Install Python dependencies (`requests`, `beautifulsoup4`).
2. Run `scripts/fetch_data.py`.
3. Read `data/data-state.json` and export workflow outputs.
4. If fetch succeeded, commit changes under `data/` and push.
5. Create a GitHub Issue only when:
   - data changes were detected, or
   - a fetch/state failure occurred.

If no change is detected and fetch succeeds, no issue is created.

## Script roles

### `fetch_data.py`

Purpose:
- Fetches 3 sources into `data/`:
  - `socrata-90th-percentile.json`
  - `DSMI-Service-Line-Materials-Estimates.xlsx`
  - `2024-2025-LSLR-Data.xlsx`

Behavior:
- Creates a backup of `data/` in `data-backup/` before fetching.
- On fetch failure, restores files from backup.
- Computes content hashes to detect source changes.
- Writes run state to `data/data-state.json`, including:
  - `changes`
  - `changes_count`
  - `fetch_success`
  - `fetch_errors`
- Exits non-zero if any fetch/restore/state error occurred.

### `merge_data.py`

Purpose:
- Merges fetched DSMI, LSLR, and Socrata data by PWSID.
- Adds centroid coordinates from `cwb/mi_cwb_centroids.geojson`.
- Writes merged output to `data/lead-data-test.csv`.

### `convertCsv.js`

Purpose:
- Reads `lead-data.csv` and converts it to frontend-ready JS.
- Writes `src/data/waterSystemsData.js`.
- Prints status counts by `Status`.


## Notes for maintainers

- The workflow only commits `data/` when `fetch_success == true`.
- Missing `data/data-state.json` is treated as a fetch failure.
- Repeated failures can create repeated issues because issue de-duplication is not implemented in the workflow.

