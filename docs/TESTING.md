# Testing — what was actually run

Results from the V2 build (2026-10-27), with .NET verification added on 2026-11-25 using SDK 10.0.401.

| Layer | What | Result | Kind |
|---|---|---|---|
| SQL schema + analytics | `database/tests` (PGlite = real PostgreSQL engine): constraints, generated columns, tenancy keys, import tables, `v_equipment_daily`, `fn_equipment_reliability`, `bi` views, C# model ↔ schema | **26 / 26 pass** | runtime |
| Python ETL | reader (CSV/XLSX quirks), production and downtime validators, pipeline against PostgreSQL 16.15 (idempotency, conflict policies, strict mode, atomicity, failure recording, tenant scoping) | pass | runtime |
| Forecasting | hand-calculated models, independent backtest check, leakage check, HTTP contract | pass | runtime |
| Anomaly detection | metric maths, weekday baseline, detectors, benchmark shape | pass | runtime |
| Excel report | structure; **LibreOffice recalculates the Summary formulas and they equal SQL**; empty range → "n/a" | pass | runtime |
| Power BI model | star-schema integrity (no orphan keys, grains), measure formulas re-computed in pandas = system numbers | pass | runtime (SQL/pandas; **not** DAX) |
| Python service API | FastAPI `TestClient`: auth, upload, errors, forecast, anomalies, report, tenant 404s, size limit | pass | runtime |
| **Python total** | `pytest services/intelligence/tests` | **142 / 142 pass** (~20 s) | runtime |
| HTTP smoke | `tools/smoke_intelligence.py`: real uvicorn process, real PostgreSQL, XLSX + CSV upload, repeat upload, bad rows, forecast, anomalies, Excel report, history | **13 / 13 checks pass** | runtime |
| Frontend | `vitest`: 51 tests (V1 29 + V2 22: imports, forecast, anomalies, reliability, series builder) with mocked `fetch` | **51 / 51 pass** | runtime (jsdom) |
| Frontend | `tsc --noEmit`, `vite build` | pass | build |
| C# | `dotnet build backend/OpsMind.slnx -c Release` | pass | build |
| C# xUnit tests | `dotnet test backend/OpsMind.slnx -c Release --no-build` | **67 / 67 pass** | unit tests; database tests use the EF Core in-memory provider |
| ASP.NET ↔ Python | `IntelligenceClient` against a fake HTTP handler (included in the xUnit suite) | pass | unit tests |
| Docker / compose | images, health checks, nginx | **never run** | not run |
| React ↔ ASP.NET ↔ Python end to end | | **not done** | not done |
| Power BI Desktop | Power Query, DAX | **not opened** | not done |

## Reproduce

```bash
# PostgreSQL 16 reachable as below (any empty server will do; tests create and drop their own databases)
export TEST_PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres TEST_PG_REQUIRED=1
cd services/intelligence && pip install -r requirements-dev.txt && python -m pytest -q
python tools/smoke_intelligence.py
cd ../../database/tests && npm ci && npm test
cd ../../frontend && npm ci && npm run typecheck && npm test && npm run build
cd ..                                          # return from frontend to the repository root
dotnet build backend/OpsMind.slnx -c Release
dotnet test backend/OpsMind.slnx -c Release --no-build
```

Without a PostgreSQL server the database tests are skipped (not failed) unless `TEST_PG_REQUIRED=1`. The LibreOffice recalculation test is skipped when `soffice` is absent (CI installs it).

## What the tests do not show

* Anything about how the system performs on real plant data. All data is synthetic.
* Whether EF Core translates and maps `SqlQuery<ReliabilityDbRow>` correctly against PostgreSQL, or whether the ASP.NET multipart upload binds over real HTTP.
* Load behaviour. The largest file exercised was ~6,500 rows (about a second).
* The anomaly benchmark is a method check on synthetic data whose design was informed by earlier benchmark runs (see `ANOMALY_DETECTION.md`).
