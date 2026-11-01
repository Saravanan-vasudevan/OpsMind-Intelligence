# Testing — what was actually run

Results from the V2 build (2026-10-27). "Runtime" means the code executed against the real thing it talks to; "source-level" means it was read or parsed but not run.

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
| C# (V1 + V2) | tree-sitter syntax parse of every `.cs` file (`tools/cs_syntax_check.py`) | 0 syntax errors | **source-level only** |
| C# xUnit tests | 51 test methods written (13 new in V2) | **never run** | not run |
| ASP.NET ↔ Python | `IntelligenceClient` against a fake handler (in the xUnit suite) | **never run** | not run |
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
python tools/cs_syntax_check.py backend         # needs: pip install tree-sitter tree-sitter-c-sharp
cd backend && dotnet test OpsMind.slnx          # first real compile of the C#: expect some fixes
```

Without a PostgreSQL server the database tests are skipped (not failed) unless `TEST_PG_REQUIRED=1`. The LibreOffice recalculation test is skipped when `soffice` is absent (CI installs it).

## What the tests do not show

* Anything about how the system performs on real plant data. All data is synthetic.
* That the C# compiles. That EF translates `SqlQuery<ReliabilityDbRow>` correctly on Npgsql.
* Load behaviour. The largest file exercised was ~6,500 rows (about a second).
* The anomaly benchmark is a method check on synthetic data whose design was informed by earlier benchmark runs (see `ANOMALY_DETECTION.md`).
