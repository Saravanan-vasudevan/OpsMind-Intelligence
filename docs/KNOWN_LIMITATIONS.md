# Known limitations (V2)

## Verification gaps (most important)
- **The C# backend (V1 and V2) has never been compiled or run.** No .NET SDK in the build environment. C# was only parsed with tree-sitter (syntax). New in V2 and unverified: `IntelligenceClient`, `IntelligenceController`, `ImportsController`, `ReliabilityController`, DI registration, the `Database.SqlQuery<ReliabilityDbRow>` call (column mapping of a `numeric`/`bigint` function result), multipart binding of `ImportUploadRequest`, and the new xUnit tests (13 written, none run).
- **Docker images and `docker compose up` have never been run** (no Docker daemon). That includes the new `intelligence` service image, health checks and the nginx upload settings.
- **The React ↔ ASP.NET ↔ Python chain has not been run end to end.** Each hop is tested separately: React against mocked `fetch`; the Python service over real HTTP against real PostgreSQL (`tools/smoke_intelligence.py`); ASP.NET not at all.
- **Power BI**: Power Query and DAX have not been opened in Power BI Desktop. The data model and the measure logic are reconciled in SQL/pandas only.
- Frontend has no browser (Playwright) tests.

## Design limits
- Scheduled minutes derive from shifts of *recorded* production; downtime is attributed to its UTC start date, no midnight split; a day with downtime but no production record is missing from `v_equipment_daily`, the Excel report and the reliability numbers' run-time side (it is present in `bi.fact_downtime`).
- Imports: plant/line/asset codes and shift names must match exactly (case-sensitive); synchronous in the request, 10 MB / 50,000 rows per file, first sheet of a workbook only, no column mapping UI (headers must match), no undo (loaded rows can be traced via `import_batch_id` but there is no "revert this batch" action).
- `update` conflict policy overwrites rows; there is no field-level history of what changed.
- Forecast: univariate daily series, four models, no calendar/holiday effects, no hierarchy reconciliation, interval from only three backtest folds (indicative, no coverage claim). Needs `28 + horizon + 14` days of history.
- Anomaly detection: precision is modest — about half or more of `robust_z` flags were not planted problems on the synthetic benchmark (see `ANOMALY_DETECTION.md`); the benchmark influenced the design, so it is not a clean hold-out; there is no real labelled data; no alert workflow.
- The Python service trusts the organisation header given a valid shared key (see ARCHITECTURE).
- Python service logging is structured JSON but there is no tracing/correlation id across API → service yet.
- Excel report: values are database-derived; the Summary KPIs are live formulas over the Daily sheet (verified by LibreOffice recalculation), the other sheets are static values. No charts in the workbook.

## Carried over from V1
- Editing a shift's times does not re-validate existing production records.
- Token validity is rechecked against the database on every request.
- `KnownNetworks` is cleared (trusts forwarded headers from any proxy); tighten for public deployment.
- No password reset / email flow, no account lockout beyond the per-IP rate limit.
- No shift filter on analytics; no OEE performance factor.
- Frontend is one large JS chunk (~700 kB+), no code splitting.
- Single `OpsMind.Api` project instead of the blueprint's three.
