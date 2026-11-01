# Development log (real issues only)

Issues found while building V1, in the order met.

1. **Restrict-FK deletes report SQLSTATE 23001, not 23503.** Deleting a row still referenced through a `RESTRICT` foreign key returned `restrict_violation` (23001) in the PGlite tests, while I had only mapped 23503. `DatabaseErrors` now maps 23505 and 23001 to 409 and 23503/23514/23502 to 400; the unit tests for it are written but not yet run under xUnit.
2. **Generated columns written explicitly.** The demo seeder set `duration_minutes` on shifts and downtime events, which are `GENERATED ALWAYS` columns, so those inserts would fail on a real database. Found while reviewing the seeder against the schema tests; the seeder no longer sets them.
3. **Compile-level mistakes caught by review/parse:** a missing Swashbuckle `using`, a variable named `from` (a C# contextual keyword in LINQ), an EF `OrderBy` placed after a constructor projection (not translatable), a redundant relationship configuration, and a transaction cast. These were found by reading, not by a compiler — more will likely appear on first `dotnet build`.
4. **Frontend:** none of note beyond normal typing fixes; typecheck, tests and build passed on the first full run after writing.

Not yet found because not yet run: anything the C# compiler, EF Core, or Docker would reveal.

# V2 (real issues only)

1. **Design note (not a bug I hit):** joining production → quality → downtime directly would count a day's downtime once per shift. `v_equipment_daily` therefore aggregates each side to machine-day in CTEs first, and `analytics.test.mjs` has a test with exactly that shape to keep it that way.
2. **pandas 3 string columns use NaN, not None, for blanks**, so a validator test expecting `None` for a blank optional field failed. Tests now use `pd.isna`, and the loader converts through one `_nullable` helper so the database receives NULL.
3. **Duplicate CSV headers were renamed by pandas** (`a`, `a.1`), hiding the user's mistake. The reader now reads with `header=None` and checks the header row itself, so `duplicate_columns` is reported.
4. **A bitwise-inverted object array**: `~identical.to_numpy()` on an object-dtype array gave -1/-2 instead of True/False when deciding which rows an `update` import had really changed. Fixed with a helper that returns a real boolean array; covered by the update-policy tests.
5. **Recording a failed import raised a second time** when the failure was an invalid user id (FK violation on `created_by`). `_record_failure` retries with `created_by = NULL`.
6. **Anomaly detector false alarms (design iteration, disclosed).** v1 used one global robust z-score per machine and flagged normal weekday patterns (weekend output, Wednesday maintenance) constantly. v2 made the baseline weekday-aware. Daily downtime share was too spiky (one stoppage = one huge value), so it became a trailing 7-day ratio with a lower scale floor. The benchmark scoring was also rewritten to count a flag anywhere in a planted event's window as a find (otherwise a 7-day metric looked like six false alarms per event). Because these changes were made while looking at benchmark output, the benchmark is **not** a clean hold-out; this is stated in `ANOMALY_DETECTION.md`.
7. **Test-suite mistakes, not product bugs:** queries without an organisation filter picked up other tests' rows; a downtime fixture overlapped itself; integer columns were assigned strings; an undefined skill-vs-baseline case asserted `None`; a 7-day-window assertion off by one day (the stoppage is still inside the window one day longer than I wrote).
8. **V1 bug found by the V2 typecheck:** `frontend/src/api/client.test.ts` did not typecheck (`.catch(e => e as ApiError)` yields `unknown`), so V1's own CI `typecheck` step would have failed even though `vitest` passed. Fixed.
9. **`starlette.testclient` in the FastAPI version used needs `httpx2`, not `httpx`.** `requirements-dev.txt` said `httpx>=0.27`, which would have failed in CI; pinned `httpx2`.
10. **Environment:** the PostgreSQL test server exited after the sandbox restarted because its default socket directory was not writable; restarted with `-k` pointing at a writable directory. Not a project issue, noted so test instructions mention `TEST_PG_ADMIN_URL`.
11. **Written by review, not by a compiler (C#):** a field named `Policies` would have shadowed the `Policies` class used in `[Authorize(Policy = Policies.AdminOnly)]`; parameter names `from`/`to` were replaced with `[FromQuery(Name = "from")] fromDate`; `ProblemDetailsFactory` has to be stubbed in controller unit tests because `ValidationProblem()` dereferences the (absent) HttpContext. Expect more on the first real `dotnet build`.
