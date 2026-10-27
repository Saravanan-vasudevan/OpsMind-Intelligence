# Architecture (as implemented in V1)

```
Browser ── nginx (frontend container, port 3000)
              ├─ static React app
              └─ /api, /health, /swagger → ASP.NET Core API (port 8080) ── PostgreSQL 16
```

- **Same-origin by design.** nginx (and the Vite dev proxy) forward `/api` so the session cookie is first-party; no CORS configuration is needed.
- **Single API project** (`backend/src/OpsMind.Api`) organised by folder: `Domain`, `Data`, `Auth`, `Controllers`, `Contracts`, `Services`, `Infrastructure`. The blueprint proposed three projects; one is simpler at this size.
- **SQL-first schema.** `database/migrations/*.sql` are embedded in the API assembly and applied at startup by `MigrationRunner` (ordered, checksummed in `schema_migrations`, guarded by a Postgres advisory lock). EF Core is used for queries only. Reason: the SQL is reviewable, testable without .NET (PGlite), and reusable by the Python and Power BI parts later.
- **Tenant isolation.** Every tenant-owned entity is filtered by `CurrentOrganisationId` with EF global query filters (reaching children through parent navigations). `IgnoreQueryFilters()` is used only for login, register, seeding and token validation.
- **Auth.** JWT stored in an HttpOnly, SameSite=Strict cookie. Unsafe requests need an `X-Requested-With: OpsMind` header. On each request the user is re-read from the database so deactivation and role changes apply immediately.
- **Errors.** One middleware converts exceptions and Postgres errors into RFC 7807 ProblemDetails with a trace id; the frontend shows the message and field errors.
- **Invariants live in the API and in the database** (unique keys, checks, generated durations, FKs). The API gives friendly messages; the database is the backstop.
- **Frontend.** React + React Router, a thin typed API client, an `useAsync` hook that cancels stale requests, forms that map server field errors onto inputs. Charts have a table alternative.
