# Development log (real issues only)

Issues found while building V1, in the order met.

1. **Restrict-FK deletes report SQLSTATE 23001, not 23503.** Deleting a row still referenced through a `RESTRICT` foreign key returned `restrict_violation` (23001) in the PGlite tests, while I had only mapped 23503. `DatabaseErrors` now maps 23505 and 23001 to 409 and 23503/23514/23502 to 400; the unit tests for it are written but not yet run under xUnit.
2. **Generated columns written explicitly.** The demo seeder set `duration_minutes` on shifts and downtime events, which are `GENERATED ALWAYS` columns, so those inserts would fail on a real database. Found while reviewing the seeder against the schema tests; the seeder no longer sets them.
3. **Compile-level mistakes caught by review/parse:** a missing Swashbuckle `using`, a variable named `from` (a C# contextual keyword in LINQ), an EF `OrderBy` placed after a constructor projection (not translatable), a redundant relationship configuration, and a transaction cast. These were found by reading, not by a compiler — more will likely appear on first `dotnet build`.
4. **Frontend:** none of note beyond normal typing fixes; typecheck, tests and build passed on the first full run after writing.

Not yet found because not yet run: anything the C# compiler, EF Core, or Docker would reveal.
