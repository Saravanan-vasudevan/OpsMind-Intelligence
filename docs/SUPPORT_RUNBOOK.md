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
