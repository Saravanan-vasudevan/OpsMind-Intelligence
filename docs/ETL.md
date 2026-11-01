# Data import (ETL)

Code: `services/intelligence/opsmind_intel/etl/`. Entry point: `run_import(...)`. HTTP: `POST /api/imports` (admin only) → ASP.NET → `POST /imports` on the Python service.

## Flow

```
file → size/extension checks ─┬─ UploadError (HTTP 400/413/415, nothing recorded)
                              └─ sha256 → already completed? ──► return that batch (alreadyImported = true)
read (CSV | XLSX) → file-level checks ─► Rejected batch (e.g. missing columns), reasons stored
row validation (pure, no DB) → lookups against the database (machine, shift, overlaps) → plan insert/update/skip
strict mode and any error? ─► Rejected batch, nothing loaded
one transaction: insert/update rows + the batch row + stored errors   ─► Completed
database error (constraint, deadlock...) ─► rolled back, Failed batch recorded
```

## Formats

| | production | downtime |
|---|---|---|
| Columns | `plant_code, line_code, asset_code, shift_name, shift_date, units_produced, target_units, run_minutes, inspected_units, rejected_units, defect_type, notes` | `plant_code, line_code, asset_code, start_time, end_time, category, reason_code, notes` |
| Required | first 8 | first 7 |
| Natural key (used for duplicates / update) | machine + shift + date | machine + start time |

Header-only templates are in `frontend/public/templates`; a test fails if they drift from `etl/schema.py`.

* **CSV**: delimiter sniffed (`,` `;` tab), UTF-8 with or without BOM, falling back to Windows-1252. **XLSX**: first sheet, read as text so typed cells (dates, numbers) are normalised the same way. Header names are matched case-insensitively with spaces/hyphens read as underscores; unknown columns are ignored with a warning.
* **Dates**: ISO (`2026-03-01`) or UK `dd/mm/yyyy` — slashes always mean day first. **Timestamps**: ISO 8601 or `dd/mm/yyyy hh:mm`; no zone means UTC.
* **Missing values**: `""`, `na`, `n/a`, `nan`, `null`, `none`, `-`, `--` mean "no value". A blank required field is an error. A blank optional field is stored as NULL. **Nothing is imputed.**
* A machine is identified by (plant_code, line_code, asset_code) because an asset code is only unique within a line.

## Validation rules (same as the manual-entry API)

run_minutes ≤ shift duration · inspected and rejected given together, rejected ≤ inspected · units, targets, minutes not negative and below sanity caps · the machine must be active · date not after tomorrow and not before 2000 · downtime end after start and within 7 days · category `Planned` or `Unplanned` · reason code `[A-Za-z0-9_-]` up to 40 characters · duplicates inside a file: first row kept, later rows rejected · downtime events overlapping another on the same machine, in the file or already stored, rejected (`overlaps_existing` for stored ones).

Row-level error codes: `missing_required, invalid_integer, out_of_range, too_long, invalid_date, date_out_of_range, future_date, invalid_timestamp, end_before_start, duration_too_long, invalid_category, invalid_reason_code, run_exceeds_shift, quality_incomplete, rejected_exceeds_inspected, duplicate_in_file, unknown_equipment, unknown_shift, equipment_inactive, overlap_in_file, overlaps_existing`. File-level (stored as a Rejected batch): `empty_file, invalid_file, unreadable_file, unsupported_format, duplicate_columns, missing_columns, no_data_rows, too_many_rows`. Request-level (HTTP error, nothing stored): `invalid_kind, invalid_policy, empty_file, file_too_large, unsupported_format`. A wrong plant, line or asset code all report `unknown_equipment`.

## Idempotency and conflicts

* A **completed** import is unique on `(organisation, kind, sha256 of the bytes, conflict_policy)` (partial unique index). Uploading the same bytes again returns the first batch with `alreadyImported: true`. Failed and rejected attempts do not block a retry.
* Two simultaneous identical uploads: the second hits the unique index, and returns the winner.
* `conflict_policy = skip` (default): a row whose natural key exists is skipped. `update`: it is overwritten, except that identical rows are counted as skipped (not "updated").
* Nothing is deleted by an import.

## Import history

`import_batches` (one row per attempt: counts, status, who, when) and `import_errors` (row, column, code, message, raw value; capped at 1000 per batch with `errorsTruncated`). Read by the API (`GET /api/imports`, `GET /api/imports/{id}/errors`) and shown on the Data imports page. Loaded rows carry `import_batch_id`, so every record can be traced to its file.

## Limits

10 MB per file, 50,000 rows per file (environment-configurable). Larger sources should be split. Processing is synchronous within the request; a 6,000-row file takes about a second on the test machine.
