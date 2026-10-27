# Known limitations (V1)

- **Backend never compiled in the authoring environment.** See README verification table.
- Scheduled minutes derive from shifts of recorded production (see KPI definitions).
- Downtime is attributed to its start date (UTC); no midnight split.
- Editing a shift's times does not re-validate existing production records (run minutes could exceed the new duration).
- Token validity is rechecked against the database on every request (correct for instant deactivation, costs a query per request).
- `KnownNetworks` is cleared so forwarded headers are trusted from any proxy; fine behind the bundled nginx, tighten for a public deployment.
- No password reset / email flow, no account lockout beyond the per-IP rate limit.
- No bulk CSV import yet (planned for V2); data entry is one record at a time.
- No shift filter on analytics; no OEE performance factor.
- Frontend bundle is a single ~700 kB chunk (no code splitting).
- Frontend has no tests for the data-entry forms or admin pages; no browser (Playwright) tests yet.
- Blueprint described three C# projects (Api/Domain/Infrastructure); V1 is a single `OpsMind.Api` project with folders.
