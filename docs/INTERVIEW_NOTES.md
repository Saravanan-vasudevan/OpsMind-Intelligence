# Interview notes — V1

## 60-second explanation
OpsMind lets a manufacturing organisation record production and downtime per machine and shift, and shows availability, target attainment and defect rate with trends and a plant comparison. It is multi-tenant with admin/user roles. Backend ASP.NET Core + PostgreSQL, frontend React/TypeScript. Demo data is synthetic.

## Decisions and trade-offs
- **SQL-first migrations vs EF migrations.** Reviewable, testable without .NET, shared with later Python/Power BI. Cost: model and schema can drift — mitigated by a test comparing them.
- **Cookie JWT vs bearer in localStorage.** HttpOnly cookie is not readable by scripts (XSS can still act as the user but cannot steal the token). Cost: CSRF exposure, handled by SameSite=Strict plus a required custom header.
- **Query filters for multi-tenancy.** Hard to forget; but `IgnoreQueryFilters` is a sharp tool, so its few uses are deliberate. Alternative: Postgres row-level security.
- **Revalidating the user per request.** Immediate deactivation, one extra query. Would cache briefly at scale.
- **Nulls instead of zeros for undefined ratios.** 0% would claim a measurement that doesn't exist.
- **Downtime by start date, scheduled time from recorded shifts.** Simple and documented, but approximations.

## Likely questions
- *How do you stop one tenant seeing another's data?* Global query filters on organisation; unit test with two organisations (written, not run yet).
- *What happens if two people enter the same record?* Unique (equipment, shift, date) → 409 with a readable message.
- *How is availability defined and why floor at 0?* See KPI doc; overlapping/oversized downtime must not give negative availability.
- *What did you not verify?* The C# was never compiled in my environment — README table lists exactly what was and wasn't run.
- *What would you do next?* Bulk import with row-level validation, a proper operating calendar, Playwright tests, RLS.

## Demo script (≈5 min, needs the stack running)
1. Sign in as the demo admin. 2. Overview: change the date range, toggle a chart to its table, export CSV. 3. Plants → a plant → shifts/lines. 4. Equipment: add a machine. 5. Production & downtime: add a record, then try a duplicate and an oversized run time to show validation. 6. Overview again: the KPI changes. 7. Audit log: the actions you just did. 8. Sign in as the standard user: admin pages are unavailable.

# Interview notes — V2 (data intelligence)

## 60-second explanation
V2 turns OpsMind from a data-entry app into a data pipeline. Admins upload CSV or Excel files; a Python service validates every row (rules mirror the API), loads valid rows in one transaction, records exactly what was accepted or rejected and why, and refuses to import the same file twice. On top of the stored data: SQL reliability metrics (MTBF, MTTR, availability with window functions), a forecast whose model is chosen by back-testing on the user's own history, anomaly flags with plain-language reasons, an Excel report with live formulas, and a Power BI star schema. I measured the anomaly detector on synthetic data with planted problems and I report that it raises a lot of false alarms.

## Decisions and trade-offs
- **Python service behind ASP.NET.** Right tool for pandas/statsmodels/scikit-learn/openpyxl; cost is a second runtime and a trust boundary (shared key + org header). Alternative I'd consider next: per-request signed tokens.
- **Validate in Python, constrain in the database.** Rows get friendly per-row errors; the CHECKs and unique indexes are the backstop. The rules are copied from the C# API, so two implementations can drift — I'd move to one shared rule set or have the API be the only writer.
- **Idempotency by file hash + kind + policy**, via a partial unique index, so a double-click or a re-upload is harmless and race-safe. Failed attempts don't block retries.
- **Never impute.** Required blanks are errors; optional blanks are NULL. Ratios with no denominator are null in the API and BLANK in DAX.
- **Back-testing instead of picking a "best" model up front.** 3 rolling folds; a baseline can win, and then the UI says so. Interval is empirical from those same folds, so I call it indicative.
- **Weekday-aware anomaly baseline** after the first version flagged ordinary weekly patterns.
- **Aggregate before joining in SQL** to avoid fan-out.

## Likely questions
- *How do you know the forecast is any good?* Per-model MAE/RMSE/WAPE/bias over rolling-origin back-tests on the user's own data, and skill versus same-weekday-last-week. I never state an accuracy figure for the product, only what the back-test showed for that series.
- *How good is your anomaly detection?* On a synthetic benchmark: finds 71–95 % of planted problems but only 31–62 % of its flags are real (robust z-score). I disclose that the benchmark informed the design, that the data is synthetic and that real performance is unknown.
- *What happens on a 50,000-row file with 1,000 bad rows?* Valid rows load atomically; the first 1,000 errors are stored with `errorsTruncated`; the response tells the user.
- *Two people upload the same file at once?* Unique partial index; the loser gets the winner's batch back.
- *Why not Spark/Airflow/dbt?* Data fits in one Postgres; a synchronous import is simpler to operate and test. I'd reach for them when files or sources outgrow a request.
- *What did you not verify?* The C# (V1+V2) was never compiled, Docker was never run, the Power BI files were never opened. Python, SQL and React were tested against real PostgreSQL / a real HTTP server / jsdom.
- *What would you do next?* Compile and fix the backend first; then a revert-this-batch action, column mapping, real labelled data for anomalies, and correlation ids from API to service.

## Demo script (≈8 min, needs the stack running)
1. Admin → Data imports: download the production template, upload a file with a few deliberately bad rows; read the row errors; upload the same file again ("already imported"). 2. Upload the generated history files. 3. Reliability: sort out the worst machine; point at MTBF "—" for a machine with no failures. 4. Forecast: change the horizon, show the backtest table and the note when a baseline wins; try a single new machine to show "not enough history". 5. Anomalies: open a flag and read the explanation; open "How well does this work?" and talk through the precision numbers. 6. Overview → Excel report; open it and click a KPI cell to show the formula. 7. Audit log shows the upload and export.
