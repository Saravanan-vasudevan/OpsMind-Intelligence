# Support runbook (V1)

| Symptom | Likely cause | Check |
|---|---|---|
| Backend exits at startup | Missing `Jwt__Secret` (<32 chars) or connection string | `docker compose logs backend` |
| `/health/ready` not 200 | Database unreachable or migrations failed | logs; `docker compose ps db`; `schema_migrations` table |
| POST/PUT/DELETE return 403 "must include the X-Requested-With header" | Calling the API without `X-Requested-With: OpsMind` (e.g. from curl/Postman) | add the header on state-changing requests |
| Logged in but immediately logged out | `Jwt__CookieSecure=true` while serving over plain HTTP, so the browser drops the cookie | set `JWT_COOKIE_SECURE=false` locally |
| 429 on login | Auth rate limit (10/min/IP) | wait a minute |
| 409 on save | Duplicate (asset code, record for equipment+shift+date, overlapping downtime) or delete blocked by history | read the message; set equipment Inactive instead of deleting |
| 400 "run minutes exceed shift" | Run minutes > shift duration | correct the entry |
| Dashboard shows — instead of 0% | No denominator (e.g. no inspected units) | by design; see KPI definitions |
| Empty dashboard after login | No data in the date range | widen range; or `SEED_DEMO_DATA=true` on an empty DB |

Useful queries (psql): `select * from schema_migrations;` · `select action, entity, created_at from audit_logs order by id desc limit 20;`

Error responses include a `traceId`. For unhandled (500) errors the same id is written in the API log line, so you can find the stack trace.

## V2 additions

| Symptom | Likely cause | Check |
|---|---|---|
| Imports/forecast/anomaly pages show "Intelligence service unavailable" (503) | Python container down or not reachable | `docker compose ps`; `curl http://localhost:8080/health/intelligence`; `docker compose logs intelligence` |
| Same pages show "Intelligence service error" (502) | Service returned an unexpected status — often a **key mismatch** (`INTERNAL_API_KEY` ≠ `Intelligence__InternalKey`) or a database error | `docker compose logs intelligence` (JSON lines; a 401 means the key differs); API logs show the upstream status |
| 504 on forecast/report | Backtests or report on a very large range exceeded 120 s | Narrow the range; raise `Intelligence__TimeoutSeconds` and nginx `proxy_read_timeout` |
| Upload says "File too large" (413) | File > 10 MB (service) / 11 MB (API) / 12 MB (nginx) | Split the file |
| Upload says every row `unknown_equipment` | plant/line/asset codes in the file don't match the organisation's structure (asset codes are only unique per line) | Compare with Plants → Lines → Equipment; codes (and shift names) are matched exactly, including upper/lower case; surrounding spaces are trimmed |
| Upload says "already imported" but nothing changed | Identical bytes + kind + policy were imported before | Change the file, or use `update` policy (a different policy is a different import) |
| Dates in a UK-format file are wrong | Slash dates are always day-first; `03/04/2026` is 3 April | Use ISO `2026-04-03` if unsure |
| Forecast says "Not enough history" | Fewer than `28 + horizon + 14` days of production | Import more history or shorten the horizon |
| Anomalies page lists nothing | Fewer than ~6 weeks of history, or genuinely nothing unusual | Check `machineDaysEvaluated` in the summary line |
| Excel report KPIs show "n/a" | No production in the chosen range (or no inspected units for defect rate) | Check the range; this is deliberate, not 0 % |
| Excel opens but KPI cells are empty | Viewer does not calculate formulas (some previewers) | Open in Excel/LibreOffice |
