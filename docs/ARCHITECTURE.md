# Architecture (V2)

```
Browser ── nginx (frontend container, :3000)
              ├─ static React app (+ /templates/*.csv)
              └─ /api, /health, /swagger → ASP.NET Core API (:8080) ──┬── PostgreSQL 16  (EF Core: CRUD, KPIs, import history, reliability)
                                                                     └── HTTP + shared key ──► Python "intelligence" service (internal only, :8000)
                                                                                                   ├─ ETL: CSV/XLSX → validate → PostgreSQL (psycopg)
                                                                                                   ├─ forecasting, anomaly detection (pandas, statsmodels, scikit-learn)
                                                                                                   └─ Excel report (openpyxl)
Power BI Desktop ── read-only role ──► PostgreSQL schema `bi` (star schema views)
```

## End-to-end flows

**Import.** React Data imports page → `POST /api/imports` (admin, cookie + CSRF header) → ASP.NET validates the request shape, forwards the bytes with `X-Internal-Key` + the organisation/user ids from the JWT → Python reads, validates and loads in one transaction and writes `import_batches`/`import_errors` → result returned and the batch is audit-logged → the page reloads the history (read by EF from the same tables).

**Forecast / anomalies / report.** React → `/api/intelligence/...` → ASP.NET (auth, parameter whitelist, org from token) → Python reads `v_equipment_daily` for that organisation only → JSON (or an `.xlsx` stream, audit-logged) back through the API.

**Dashboards and reliability.** Unchanged V1 KPI endpoints (EF/LINQ), plus `/api/analytics/reliability` which calls the SQL function `fn_equipment_reliability` with the organisation id from the token.

## Decisions

* **Why a Python service at all.** Time-series models, isolation forests and Excel formula workbooks are a few lines in pandas/statsmodels/scikit-learn/openpyxl and a lot of unmaintained code in C#. The cost is a second runtime and a service boundary; it is kept small (one container, six endpoints) and is not reachable from outside the compose network.
* **The browser never calls Python.** The API owns authentication, tenancy and audit. The service trusts the organisation header only because it checks the shared key on every call and is not published on a host port. If the key leaks, tenant isolation for those endpoints is gone — that is the trade-off of header-based trust; mutual TLS or signed per-request tokens would be the next step.
* **Python writes imports, ASP.NET reads them.** Both go through the same migrations and constraints; the database is the contract (`model-matches-schema` test covers the C# entities).
* **Everything is organisation-scoped in SQL.** Python queries filter on `organisation_id` explicitly (there is no ORM filter to forget about); tests assert another organisation's data never appears in imports, forecasts, anomalies or reports.
* **Upstream failures are translated** (see `API_V2.md`) so a service problem is never presented as "you are signed out".
* **No hidden state.** The only cache is the synthetic anomaly benchmark (deterministic, per process).

## Unchanged from V1

Same-origin nginx proxy; single API project organised by folder; SQL-first migrations embedded in the API and applied at startup with a checksum and advisory lock; EF global tenant filters; JWT in an HttpOnly SameSite=Strict cookie plus the `X-Requested-With` header; ProblemDetails everywhere; invariants enforced both in code and in the database.
