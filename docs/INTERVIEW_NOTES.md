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
