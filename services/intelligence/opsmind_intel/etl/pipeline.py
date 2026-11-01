"""Import orchestration: read, validate, plan, write, and record history. Idempotent by file content hash."""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

import psycopg
from psycopg.rows import dict_row

from ..config import Settings
from .errors import FileRejected, RowError
from .loader import Plan, load_lookups, plan_downtime, plan_production, write_downtime, write_production
from .reader import read_table, sha256_hex
from .validate import validate_downtime, validate_production

log = logging.getLogger("opsmind.etl")

KINDS = ("production", "downtime")
POLICIES = ("skip", "update")


class UploadError(Exception):
    """The request itself is unacceptable (bad parameters, unsupported or empty file). No history row is written."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ImportResult:
    batch_id: uuid.UUID
    kind: str
    file_name: str
    status: str
    total_rows: int
    inserted_rows: int
    updated_rows: int
    skipped_rows: int
    rejected_rows: int
    errors_truncated: bool
    message: str
    already_imported: bool = False
    warnings: list[str] = field(default_factory=list)
    errors_preview: list[RowError] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "batchId": str(self.batch_id), "kind": self.kind, "fileName": self.file_name, "status": self.status,
            "totalRows": self.total_rows, "insertedRows": self.inserted_rows, "updatedRows": self.updated_rows,
            "skippedRows": self.skipped_rows, "rejectedRows": self.rejected_rows, "errorsTruncated": self.errors_truncated,
            "message": self.message, "alreadyImported": self.already_imported, "warnings": self.warnings,
            "errorsPreview": [
                {"rowNumber": e.row_number, "column": e.column, "code": e.code, "message": e.message, "rawValue": e.raw_value}
                for e in self.errors_preview],
        }


def _from_row(row: dict, already: bool = False, warnings: list[str] | None = None, preview: list[RowError] | None = None) -> ImportResult:
    return ImportResult(
        batch_id=row["id"], kind=row["kind"], file_name=row["file_name"], status=row["status"], total_rows=row["total_rows"],
        inserted_rows=row["inserted_rows"], updated_rows=row["updated_rows"], skipped_rows=row["skipped_rows"],
        rejected_rows=row["rejected_rows"], errors_truncated=row["errors_truncated"], message=row["message"] or "",
        already_imported=already, warnings=warnings or [], errors_preview=preview or [])


def _insert_batch(conn, org, user, kind, file_name, sha, fmt, policy, strict, status, counts, truncated, message) -> dict:
    return conn.execute(
        """INSERT INTO import_batches (organisation_id, kind, file_name, file_sha256, source_format, conflict_policy, strict, status,
               total_rows, inserted_rows, updated_rows, skipped_rows, rejected_rows, errors_truncated, message, created_by, completed_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now()) RETURNING *""",
        (org, kind, file_name, sha, fmt, policy, strict, status, counts["total"], counts["inserted"], counts["updated"],
         counts["skipped"], counts["rejected"], truncated, message, user)).fetchone()


def _insert_errors(conn, batch_id, errors: list[RowError], cap: int) -> bool:
    kept = errors[:cap]
    if kept:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO import_errors (batch_id, row_number, column_name, code, message, raw_value) VALUES (%s,%s,%s,%s,%s,%s)",
                [(batch_id, e.row_number, e.column, e.code, e.message, (e.raw_value or None) and e.raw_value[:200]) for e in kept])
    return len(errors) > cap


def _find_completed(conn, org, kind, sha, policy) -> dict | None:
    return conn.execute(
        "SELECT * FROM import_batches WHERE organisation_id=%s AND kind=%s AND file_sha256=%s AND conflict_policy=%s AND status='Completed'",
        (org, kind, sha, policy)).fetchone()


ZERO = {"total": 0, "inserted": 0, "updated": 0, "skipped": 0, "rejected": 0}


def run_import(database_url: str, settings: Settings, organisation_id: uuid.UUID, user_id: uuid.UUID | None,
               file_name: str, content: bytes, kind: str, conflict_policy: str = "skip", strict: bool = False) -> ImportResult:
    started = time.perf_counter()
    if kind not in KINDS:
        raise UploadError("invalid_kind", f"kind must be one of: {', '.join(KINDS)}.")
    if conflict_policy not in POLICIES:
        raise UploadError("invalid_policy", f"conflict_policy must be one of: {', '.join(POLICIES)}.")
    if not content:
        raise UploadError("empty_file", "The file is empty.")
    if len(content) > settings.max_upload_bytes:
        raise UploadError("file_too_large", f"The file is larger than {settings.max_upload_bytes // (1024 * 1024)} MB.")
    lower = file_name.lower()
    if not (lower.endswith(".csv") or lower.endswith(".xlsx")):
        raise UploadError("unsupported_format", "Only .csv and .xlsx files are supported.")
    fmt = "csv" if lower.endswith(".csv") else "xlsx"
    file_name = file_name.replace("\\", "/").rsplit("/", 1)[-1][:200]
    sha = sha256_hex(content)

    with psycopg.connect(database_url, row_factory=dict_row, autocommit=True) as conn:
        # 1. Idempotency: the same bytes, kind and policy are never loaded twice.
        previous = _find_completed(conn, organisation_id, kind, sha, conflict_policy)
        if previous:
            log.info("import skipped: file already imported", extra={"organisation_id": str(organisation_id), "kind": kind, "batch_id": str(previous["id"])})
            return _from_row(previous, already=True)

        # 2. File-level problems are recorded as a Rejected batch.
        try:
            table = read_table(content, file_name, kind, settings.max_rows)
        except FileRejected as rejection:
            with conn.transaction():
                batch = _insert_batch(conn, organisation_id, user_id, kind, file_name, sha, fmt, conflict_policy, strict,
                                      "Rejected", ZERO, False, rejection.message)
                _insert_errors(conn, batch["id"], [RowError(0, None, rejection.code, rejection.message)], settings.max_stored_errors)
            log.warning("import rejected", extra={"organisation_id": str(organisation_id), "kind": kind, "code": rejection.code})
            return _from_row(batch, preview=[RowError(0, None, rejection.code, rejection.message)])

        # 3. Row validation and database checks (read-only).
        lookups = load_lookups(conn, organisation_id)
        validation = validate_production(table.frame, lookups) if kind == "production" else validate_downtime(table.frame, lookups)
        planner = plan_production if kind == "production" else plan_downtime
        plan: Plan = planner(conn, validation.valid, conflict_policy)

        errors = sorted(validation.errors + plan.errors, key=lambda e: (e.row_number, e.column or ""))
        rejected_rows = len({e.row_number for e in errors})
        if plan.errors:  # rows rejected by database checks must not be loaded
            bad = {e.row_number for e in plan.errors}
            plan.to_insert = plan.to_insert[~plan.to_insert["row_number"].isin(bad)]
            plan.to_update = plan.to_update[~plan.to_update["row_number"].isin(bad)]
        total = validation.total_rows

        if strict and errors:
            counts = {**ZERO, "total": total, "rejected": rejected_rows}
            message = f"Strict mode: {rejected_rows} of {total} rows have errors, so nothing was loaded."
            with conn.transaction():
                batch = _insert_batch(conn, organisation_id, user_id, kind, file_name, sha, fmt, conflict_policy, strict,
                                      "Rejected", counts, len(errors) > settings.max_stored_errors, message)
                _insert_errors(conn, batch["id"], errors, settings.max_stored_errors)
            return _from_row(batch, warnings=table.warnings, preview=errors[:50])

        counts = {"total": total, "inserted": len(plan.to_insert), "updated": len(plan.to_update),
                  "skipped": plan.unchanged, "rejected": rejected_rows}
        message = (f"Loaded {counts['inserted']} new and {counts['updated']} updated rows; {counts['skipped']} already present; "
                   f"{counts['rejected']} rejected.")
        try:
            with conn.transaction():
                truncated = len(errors) > settings.max_stored_errors
                batch = _insert_batch(conn, organisation_id, user_id, kind, file_name, sha, fmt, conflict_policy, strict,
                                      "Completed", counts, truncated, message)
                _insert_errors(conn, batch["id"], errors, settings.max_stored_errors)
                (write_production if kind == "production" else write_downtime)(conn, plan, batch["id"], user_id)
        except psycopg.errors.UniqueViolation:
            # Either a concurrent identical upload won the race, or another writer took one of our keys.
            winner = _find_completed(conn, organisation_id, kind, sha, conflict_policy)
            if winner:
                return _from_row(winner, already=True)
            return _record_failure(conn, settings, organisation_id, user_id, kind, file_name, sha, fmt, conflict_policy, strict, total,
                                   "Another change conflicted with this import while it was running. Nothing was loaded; try again.")
        except psycopg.Error:
            log.exception("import failed", extra={"organisation_id": str(organisation_id), "kind": kind})
            return _record_failure(conn, settings, organisation_id, user_id, kind, file_name, sha, fmt, conflict_policy, strict, total,
                                   "The import failed while writing to the database. Nothing was loaded.")

        log.info("import completed", extra={
            "organisation_id": str(organisation_id), "kind": kind, "batch_id": str(batch["id"]), "rows": total,
            "inserted": counts["inserted"], "updated": counts["updated"], "skipped": counts["skipped"],
            "rejected": counts["rejected"], "duration_ms": round((time.perf_counter() - started) * 1000)})
        return _from_row(batch, warnings=table.warnings, preview=errors[:50])


def _record_failure(conn, settings, org, user, kind, file_name, sha, fmt, policy, strict, total, message) -> ImportResult:
    counts = {**ZERO, "total": total}
    try:
        with conn.transaction():
            batch = _insert_batch(conn, org, user, kind, file_name, sha, fmt, policy, strict, "Failed", counts, False, message)
    except psycopg.errors.ForeignKeyViolation:
        # The failure may itself have been caused by an unknown user id; keep the history row without it.
        with conn.transaction():
            batch = _insert_batch(conn, org, None, kind, file_name, sha, fmt, policy, strict, "Failed", counts, False, message)
    return _from_row(batch)
