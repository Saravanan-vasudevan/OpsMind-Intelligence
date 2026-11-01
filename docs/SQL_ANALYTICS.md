# Advanced SQL

All in `database/migrations/002_imports_analytics_bi.sql`; tested on a real PostgreSQL engine in `database/tests/analytics.test.mjs` (13 tests) and `services/intelligence/tests/test_bi_model.py`.

| Object | Techniques | Why |
|---|---|---|
| `v_equipment_daily` | two CTEs (production, downtime) aggregated to machine-day **before** joining; LEFT JOINs; `avg() OVER (PARTITION BY equipment ORDER BY day RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW)` | Joining production to quality to downtime directly multiplies rows (a day with 3 shifts and 2 downtime events counts downtime 3 times). Aggregating first avoids it; a test with this exact shape checks it. The window is by calendar days, not "last 7 rows", so gaps do not stretch it. |
| `fn_equipment_reliability(org, from, to)` | CTEs (scope, run, dt, joined), `FILTER (WHERE …)`, `RANK()`, `SUM() OVER (PARTITION BY plant ORDER BY …)` for a running Pareto | MTBF = run minutes ÷ unplanned failures, MTTR = unplanned minutes ÷ failures, availability as in the API; MTBF/MTTR are NULL with no failures. |
| `bi.*` views | star schema | see `powerbi/README.md` |
| `import_batches`, `import_errors` | CHECK constraints (status vocabulary, counts add up), partial unique index for idempotency | integrity in the database, not just in Python |

Limitation: a day with downtime but **no production record** is invisible in `v_equipment_daily` (it is machine-day based on production). The API KPI and the Excel report make the same choice, and `fact_downtime` in the star schema does include such events.
