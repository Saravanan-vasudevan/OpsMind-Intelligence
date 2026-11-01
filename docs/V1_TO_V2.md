# V1 → V2 changes

V1 (`v1-fullstack`) is untouched: same tag, same files at that commit. V2 continues on the same branch.

## Added
* **Migration 002**: `import_batches`, `import_errors`, `import_batch_id` lineage columns, `v_equipment_daily`, `fn_equipment_reliability`, schema `bi` (star schema).
* **`services/intelligence`** (Python): ETL for CSV/XLSX, forecasting, anomaly detection, Excel report, FastAPI service, Dockerfile, 142 tests, HTTP smoke script, history generator.
* **ASP.NET**: `IntelligenceClient`, `IntelligenceController`, `ImportsController`, `ReliabilityController`, `ImportBatch`/`ImportError` entities, health check `/health/intelligence`, 13 xUnit tests.
* **React**: Data imports, Forecast, Anomalies, Reliability pages; Excel report link on Overview; multipart support in the API client; 22 tests; CSV templates.
* **Power BI**: Power Query, DAX measures, model README.
* **Docs**: ETL, FORECASTING, ANOMALY_DETECTION, SQL_ANALYTICS, API_V2, TESTING, this file; updated ARCHITECTURE, DATA_GENERATION, KNOWN_LIMITATIONS, DEV_LOG, INTERVIEW_NOTES, GIT_PUBLISHING, README.
* **Compose / CI / env**: `intelligence` service, `INTERNAL_API_KEY`, nginx upload size and timeouts, a Python CI job with PostgreSQL.

## Changed
* `docker-compose.yml`: backend now depends on `intelligence`; **a V1 `.env` needs `INTERNAL_API_KEY` added or compose will refuse to start.**
* `ProductionRecord` and `DowntimeEvent` gained a nullable `ImportBatchId` (database column added by migration 002; existing rows get NULL).
* `OpsMindDbContext`: two new DbSets and tenant filters for imports.
* Overview page header: second action link (Excel report).

## Fixed (V1 issues found during V2)
* `frontend/src/api/client.test.ts` failed `tsc --noEmit` (three lines), which would have broken V1's own CI typecheck step. Fixed; no behaviour change.
* `docs/DATA_GENERATION.md` said the seeder ends "today"; it ends yesterday.

## Not changed / still open from V1
Everything in the "Carried over from V1" list in `KNOWN_LIMITATIONS.md`, and the fact that the C# has not been compiled.
