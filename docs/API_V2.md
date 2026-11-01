# API contracts added in V2

All under the existing cookie session + `X-Requested-With: OpsMind` rule. Errors are RFC 7807 problem JSON (`title`, `detail`, `status`, optional `code`, `errors`). Tenant is always taken from the token, never from the request.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/imports` (multipart: `file`, `kind` = production\|downtime, `conflictPolicy` = skip\|update, `strict` bool) | Admin | Upload; returns the import result (below) |
| `GET /api/imports?kind=&status=&page=&pageSize=` | any | Import history, newest first |
| `GET /api/imports/{id}/errors?page=&pageSize=` | any | Stored row problems (404 for another organisation's batch) |
| `GET /api/analytics/reliability?from=&to=&plantId=&equipmentId=` | any | `fn_equipment_reliability` rows |
| `GET /api/intelligence/forecast?metric=units\|unplanned_downtime_minutes&horizon=1..28&plantId=&equipmentId=` | any | Backtested forecast |
| `GET /api/intelligence/anomalies?from=&to=&method=robust_z\|isolation_forest&plantId=&equipmentId=&threshold=&limit=` | any | Flags with explanations |
| `GET /api/intelligence/anomalies/evaluation` | any | Synthetic benchmark (independent of caller's data) |
| `GET /api/intelligence/reports/operations.xlsx?from=&to=&plantId=&includeAnomalies=` | any | Excel report; audit-logged |

Import result: `batchId, kind, fileName, status (Completed|Rejected|Failed), totalRows, insertedRows, updatedRows, skippedRows, rejectedRows, errorsTruncated, message, alreadyImported, warnings[], errorsPreview[{rowNumber, column, code, message, rawValue}]`.

Statuses from the Python service that reach the browser: 200, 400, 404, 413, 415, 422 (with problem body). Anything else becomes **502** `intelligence_error`; an unreachable service is **503** `intelligence_unavailable`, a timeout **504**. A wrong shared key is deliberately *not* passed on as 401, which the SPA would read as "your session expired". Unit tests: `IntelligenceClientTests`.

The Python service itself (internal only; header `X-Internal-Key`, `X-Organisation-Id`, `X-User-Id`): `/health`, `/imports`, `/forecast`, `/anomalies`, `/anomalies/evaluation`, `/reports/operations.xlsx`; OpenAPI at `/openapi.json`.
