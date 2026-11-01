"""Import pipeline against a real PostgreSQL database with the real migrations."""
from __future__ import annotations

import io
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date, timedelta

import openpyxl
import pandas as pd
import pytest

from conftest import make_org
from opsmind_intel.etl.pipeline import UploadError, run_import
from opsmind_intel.etl.schema import PRODUCTION_COLUMNS
from opsmind_intel.synthetic import generate

START = date(2026, 3, 2)   # a Monday, safely in the past


def csv_bytes(df: pd.DataFrame) -> bytes:
    return df.to_csv(index=False).encode("utf-8")


def count(conn, sql, *params) -> int:
    return conn.execute(sql, params).fetchone()["n"]


ORG_JOIN = ("JOIN equipment e ON e.id = p.equipment_id JOIN production_lines l ON l.id = e.production_line_id "
            "JOIN plants pl ON pl.id = l.plant_id JOIN shifts s ON s.id = p.shift_id")


def records_for(conn, org) -> int:
    return count(conn, """SELECT count(*) n FROM production_records p JOIN equipment e ON e.id = p.equipment_id
                          JOIN production_lines l ON l.id = e.production_line_id JOIN plants pl ON pl.id = l.plant_id
                          WHERE pl.organisation_id = %s""", org)


@pytest.fixture()
def small_org(conn, small_specs):
    return make_org(conn, specs=small_specs)


def small_data(small_specs, days=7):
    return generate(START, days, seed=1, specs=small_specs)


def do_import(settings, org, name, content, kind="production", **kw):
    return run_import(settings.database_url, settings, org, kw.pop("user_id", None), name, content, kind, **kw)


def test_production_import_loads_rows_quality_and_history(conn, settings, small_org, small_specs):
    data = small_data(small_specs)
    r = do_import(settings, small_org, "week1.csv", csv_bytes(data.production))

    n = len(data.production)
    assert (r.status, r.total_rows, r.inserted_rows, r.rejected_rows) == ("Completed", n, n, 0)
    assert records_for(conn, small_org) == n
    assert count(conn, "SELECT count(*) n FROM quality_records q JOIN production_records p ON p.id = q.production_record_id WHERE p.import_batch_id = %s", r.batch_id) == n
    batch = conn.execute("SELECT * FROM import_batches WHERE id = %s", (r.batch_id,)).fetchone()
    assert batch["file_name"] == "week1.csv" and batch["source_format"] == "csv" and len(batch["file_sha256"]) == 64
    assert batch["inserted_rows"] == n and batch["completed_at"] is not None


def test_loaded_values_match_the_file(conn, settings, small_org, small_specs):
    data = small_data(small_specs, days=3)
    do_import(settings, small_org, "a.csv", csv_bytes(data.production))
    first = data.production.iloc[0]
    row = conn.execute(
        """SELECT p.units_produced, p.target_units, p.run_minutes, q.inspected_units, q.rejected_units FROM production_records p
           JOIN quality_records q ON q.production_record_id = p.id JOIN equipment e ON e.id = p.equipment_id
           JOIN shifts s ON s.id = p.shift_id JOIN production_lines l ON l.id = e.production_line_id JOIN plants pl ON pl.id = l.plant_id
           WHERE pl.organisation_id = %s AND e.asset_code = %s AND s.name = %s AND p.shift_date = %s""",
        (small_org, first["asset_code"], first["shift_name"], first["shift_date"])).fetchone()
    assert (row["units_produced"], row["target_units"], row["run_minutes"]) == (first["units_produced"], first["target_units"], first["run_minutes"])
    assert (row["inspected_units"], row["rejected_units"]) == (first["inspected_units"], first["rejected_units"])


def test_importing_the_same_file_twice_changes_nothing(conn, settings, small_org, small_specs):
    content = csv_bytes(small_data(small_specs).production)
    first = do_import(settings, small_org, "a.csv", content)
    second = do_import(settings, small_org, "renamed.csv", content)   # the name is irrelevant, the bytes are the identity
    assert second.already_imported and second.batch_id == first.batch_id
    assert records_for(conn, small_org) == first.inserted_rows
    assert count(conn, "SELECT count(*) n FROM import_batches WHERE organisation_id = %s", small_org) == 1


def test_a_different_file_with_the_same_rows_is_skipped_row_by_row(conn, settings, small_org, small_specs):
    data = small_data(small_specs)
    first = do_import(settings, small_org, "a.csv", csv_bytes(data.production))
    shuffled = data.production.sample(frac=1, random_state=3)
    second = do_import(settings, small_org, "b.csv", csv_bytes(shuffled))
    assert not second.already_imported
    assert (second.inserted_rows, second.skipped_rows, second.updated_rows) == (0, first.inserted_rows, 0)
    assert records_for(conn, small_org) == first.inserted_rows


def test_update_policy_changes_only_rows_that_differ(conn, settings, small_org, small_specs):
    data = small_data(small_specs, days=3)
    do_import(settings, small_org, "a.csv", csv_bytes(data.production))
    changed = data.production.copy().astype({"inspected_units": object, "rejected_units": object})
    changed.loc[0, "units_produced"] = changed.loc[0, "units_produced"] + 5
    changed.loc[1, "inspected_units"] = ""      # quality removed on this row
    changed.loc[1, "rejected_units"] = ""
    r = do_import(settings, small_org, "b.csv", csv_bytes(changed), conflict_policy="update")
    assert (r.inserted_rows, r.updated_rows, r.skipped_rows) == (0, 2, len(changed) - 2)
    p0, p1 = changed.iloc[0], changed.iloc[1]
    got = conn.execute(f"SELECT p.units_produced FROM production_records p {ORG_JOIN} "
                       "WHERE pl.organisation_id=%s AND e.asset_code=%s AND s.name=%s AND p.shift_date=%s",
                       (small_org, p0["asset_code"], p0["shift_name"], p0["shift_date"])).fetchone()
    assert got["units_produced"] == p0["units_produced"]
    no_quality = conn.execute(f"SELECT count(*) n FROM quality_records q JOIN production_records p ON p.id=q.production_record_id {ORG_JOIN} "
                              "WHERE pl.organisation_id=%s AND e.asset_code=%s AND s.name=%s AND p.shift_date=%s",
                              (small_org, p1["asset_code"], p1["shift_name"], p1["shift_date"])).fetchone()
    assert no_quality["n"] == 0


def test_skip_policy_does_not_overwrite_existing_values(conn, settings, small_org, small_specs):
    data = small_data(small_specs, days=2)
    do_import(settings, small_org, "a.csv", csv_bytes(data.production))
    changed = data.production.copy()
    changed["units_produced"] = changed["units_produced"] + 1000
    r = do_import(settings, small_org, "b.csv", csv_bytes(changed))
    assert r.skipped_rows == len(changed) and r.updated_rows == 0
    stored = conn.execute("SELECT sum(p.units_produced) s FROM production_records p JOIN equipment e ON e.id=p.equipment_id "
                          "JOIN production_lines l ON l.id=e.production_line_id JOIN plants pl ON pl.id=l.plant_id WHERE pl.organisation_id=%s", (small_org,)).fetchone()["s"]
    assert int(stored) == int(data.production["units_produced"].sum())      # original values, not the +1000 ones


def test_partial_acceptance_loads_valid_rows_and_stores_row_level_errors(conn, settings, small_org, small_specs):
    df = small_data(small_specs, days=3).production.reset_index(drop=True).astype(object)
    n = len(df)
    df.loc[0, "units_produced"] = "abc"
    df.loc[1, "asset_code"] = "NOPE"
    df.loc[2, "run_minutes"] = "9999"
    df.loc[3, "shift_date"] = "31/02/2026"
    r = do_import(settings, small_org, "dirty.csv", csv_bytes(df))
    assert (r.status, r.total_rows, r.inserted_rows, r.rejected_rows) == ("Completed", n, n - 4, 4)
    assert records_for(conn, small_org) == n - 4
    errors = conn.execute("SELECT row_number, column_name, code, raw_value FROM import_errors WHERE batch_id = %s ORDER BY row_number", (r.batch_id,)).fetchall()
    assert [(e["row_number"], e["code"]) for e in errors] == [(2, "invalid_integer"), (3, "unknown_equipment"), (4, "out_of_range"), (5, "invalid_date")]
    assert errors[0]["raw_value"] == "abc"
    assert [e.row_number for e in r.errors_preview] == [2, 3, 4, 5]


def test_strict_mode_loads_nothing_when_any_row_is_bad_and_a_corrected_retry_works(conn, settings, small_org, small_specs):
    df = small_data(small_specs, days=2).production.reset_index(drop=True)
    bad = df.copy().astype(object)
    bad.loc[0, "units_produced"] = "x"
    r = do_import(settings, small_org, "strict.csv", csv_bytes(bad), strict=True)
    assert r.status == "Rejected" and r.inserted_rows == 0 and r.rejected_rows == 1 and "nothing was loaded" in r.message
    assert records_for(conn, small_org) == 0
    fixed = do_import(settings, small_org, "strict2.csv", csv_bytes(df), strict=True)
    assert fixed.status == "Completed" and fixed.inserted_rows == len(df)
    # The rejected attempt never blocks the same bytes later being accepted non-strictly.
    again = do_import(settings, small_org, "strict.csv", csv_bytes(bad))
    assert (again.status, again.inserted_rows, again.skipped_rows, again.rejected_rows) == ("Completed", 0, len(df) - 1, 1)


def test_file_level_problems_are_recorded_as_rejected_batches(conn, settings, small_org):
    r = do_import(settings, small_org, "wrong.csv", b"a,b,c\n1,2,3\n")
    assert r.status == "Rejected" and "Required column" in r.message
    row = conn.execute("SELECT code, row_number FROM import_errors WHERE batch_id = %s", (r.batch_id,)).fetchone()
    assert (row["code"], row["row_number"]) == ("missing_columns", 0)


@pytest.mark.parametrize("name,content,kind,policy,code", [
    ("a.pdf", b"x", "production", "skip", "unsupported_format"),
    ("a.csv", b"", "production", "skip", "empty_file"),
    ("a.csv", b"x", "sales", "skip", "invalid_kind"),
    ("a.csv", b"x", "production", "merge", "invalid_policy"),
])
def test_unacceptable_requests_raise_and_leave_no_history(conn, settings, small_org, name, content, kind, policy, code):
    with pytest.raises(UploadError) as exc:
        do_import(settings, small_org, name, content, kind=kind, conflict_policy=policy)
    assert exc.value.code == code
    assert count(conn, "SELECT count(*) n FROM import_batches WHERE organisation_id = %s", small_org) == 0


def test_oversized_upload_is_refused(settings, small_org):
    tiny = replace(settings, max_upload_bytes=10)
    with pytest.raises(UploadError) as exc:
        do_import(tiny, small_org, "a.csv", b"x" * 11)
    assert exc.value.code == "file_too_large"


def test_tenant_isolation_same_codes_in_two_organisations(conn, settings, small_org, small_specs):
    other = make_org(conn, specs=small_specs)           # identical plant/line/asset codes
    empty = make_org(conn, with_structure=False)        # no structure at all
    content = csv_bytes(small_data(small_specs, days=2).production)

    r = do_import(settings, small_org, "a.csv", content)
    assert records_for(conn, small_org) == r.inserted_rows and records_for(conn, other) == 0

    # The same bytes for the other organisation are a separate import, not "already imported".
    r2 = do_import(settings, other, "a.csv", content)
    assert not r2.already_imported and r2.inserted_rows == r.inserted_rows
    assert records_for(conn, small_org) == r.inserted_rows

    nothing = do_import(settings, empty, "a.csv", content)
    assert nothing.inserted_rows == 0 and nothing.rejected_rows == nothing.total_rows
    assert {e.code for e in nothing.errors_preview} == {"unknown_equipment"}


def test_excel_upload_end_to_end(conn, settings, small_org, small_specs):
    df = small_data(small_specs, days=2).production
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(PRODUCTION_COLUMNS)
    for rec in df.itertuples(index=False):
        ws.append([rec.plant_code, rec.line_code, rec.asset_code, rec.shift_name, date.fromisoformat(rec.shift_date), rec.units_produced,
                   rec.target_units, rec.run_minutes, rec.inspected_units, rec.rejected_units, rec.defect_type or None, None])
    buf = io.BytesIO()
    wb.save(buf)
    r = do_import(settings, small_org, "book.xlsx", buf.getvalue())
    assert r.status == "Completed" and r.inserted_rows == len(df) and r.rejected_rows == 0
    assert conn.execute("SELECT source_format f FROM import_batches WHERE id = %s", (r.batch_id,)).fetchone()["f"] == "xlsx"


def test_error_storage_is_capped_but_counts_are_not(conn, settings, small_org, small_specs):
    df = small_data(small_specs, days=3).production.reset_index(drop=True)
    df["units_produced"] = "bad"
    r = do_import(replace(settings, max_stored_errors=5), small_org, "bad.csv", csv_bytes(df))
    assert r.rejected_rows == len(df) and r.errors_truncated
    assert count(conn, "SELECT count(*) n FROM import_errors WHERE batch_id = %s", r.batch_id) == 5


def test_database_failure_is_recorded_and_nothing_is_loaded(conn, settings, small_org, small_specs):
    content = csv_bytes(small_data(small_specs, days=2).production)
    r = do_import(settings, small_org, "a.csv", content, user_id=uuid.uuid4())   # created_by -> unknown user violates the FK
    assert r.status == "Failed" and "Nothing was loaded" in r.message
    assert records_for(conn, small_org) == 0
    retry = do_import(settings, small_org, "a.csv", content)                      # a failed attempt does not block a retry
    assert retry.status == "Completed" and retry.inserted_rows > 0


def test_created_by_and_lineage_are_recorded(conn, settings, small_org, small_specs):
    user = conn.execute("INSERT INTO users (organisation_id, email, password_hash, full_name, role) VALUES (%s,%s,'x','U','User') RETURNING id",
                        (small_org, f"{uuid.uuid4().hex[:6]}@example.test")).fetchone()["id"]
    r = do_import(settings, small_org, "a.csv", csv_bytes(small_data(small_specs, days=1).production), user_id=user)
    assert count(conn, "SELECT count(*) n FROM production_records WHERE import_batch_id = %s AND created_by = %s", r.batch_id, user) == r.inserted_rows


def test_concurrent_identical_uploads_load_the_data_once(conn, settings, small_org, small_specs):
    content = csv_bytes(small_data(small_specs, days=14).production)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda i: do_import(settings, small_org, f"c{i}.csv", content), range(2)))
    assert {r.batch_id for r in results} == {results[0].batch_id}
    assert sum(1 for r in results if r.already_imported) == 1
    assert records_for(conn, small_org) == len(small_data(small_specs, days=14).production)
    assert count(conn, "SELECT count(*) n FROM import_batches WHERE organisation_id=%s AND status='Completed'", small_org) == 1


# ---- downtime ---------------------------------------------------------------------------------------

def test_downtime_import_and_idempotency(conn, settings, small_org, small_specs):
    down = small_data(small_specs, days=14).downtime
    assert len(down) > 3
    r = do_import(settings, small_org, "d.csv", csv_bytes(down), kind="downtime")
    assert (r.status, r.inserted_rows, r.rejected_rows) == ("Completed", len(down), 0)
    assert do_import(settings, small_org, "d.csv", csv_bytes(down), kind="downtime").already_imported
    total = conn.execute("SELECT sum(duration_minutes) s FROM downtime_events d JOIN equipment e ON e.id=d.equipment_id "
                         "JOIN production_lines l ON l.id=e.production_line_id JOIN plants p ON p.id=l.plant_id WHERE p.organisation_id=%s", (small_org,)).fetchone()["s"]
    expected = sum((pd.Timestamp(e) - pd.Timestamp(s)).total_seconds() / 60 for s, e in zip(down["start_time"], down["end_time"]))
    assert float(total) == pytest.approx(expected)


def test_downtime_overlapping_stored_events_is_rejected_and_same_start_follows_the_policy(conn, settings, small_org):
    base = {"plant_code": "NORTH", "line_code": "L1", "asset_code": "N1-M01", "category": "Unplanned", "reason_code": "JAM", "notes": ""}
    first = pd.DataFrame([{**base, "start_time": "2026-03-03T08:00:00Z", "end_time": "2026-03-03T09:00:00Z"}])
    do_import(settings, small_org, "d1.csv", csv_bytes(first), kind="downtime")

    second = pd.DataFrame([
        {**base, "start_time": "2026-03-03T07:30:00Z", "end_time": "2026-03-03T07:45:00Z"},   # clear of the stored event: fine
        {**base, "start_time": "2026-03-03T08:00:00Z", "end_time": "2026-03-03T09:00:00Z"},   # same start, identical
        {**base, "asset_code": "N1-M02", "start_time": "2026-03-03T08:30:00Z", "end_time": "2026-03-03T09:30:00Z"},   # other machine: fine
    ])
    r = do_import(settings, small_org, "d2.csv", csv_bytes(second), kind="downtime")
    assert (r.inserted_rows, r.skipped_rows, r.rejected_rows) == (2, 1, 0)

    overlapping = pd.DataFrame([{**base, "start_time": "2026-03-03T08:30:00Z", "end_time": "2026-03-03T08:50:00Z"}])
    o = do_import(settings, small_org, "d2b.csv", csv_bytes(overlapping), kind="downtime")
    assert (o.inserted_rows, o.rejected_rows) == (0, 1)
    assert [e.code for e in o.errors_preview] == ["overlaps_existing"]
    touching = pd.DataFrame([{**base, "start_time": "2026-03-03T09:00:00Z", "end_time": "2026-03-03T09:20:00Z"}])   # starts as the stored one ends
    assert do_import(settings, small_org, "d2c.csv", csv_bytes(touching), kind="downtime").inserted_rows == 1

    changed = pd.DataFrame([{**base, "start_time": "2026-03-03T08:00:00Z", "end_time": "2026-03-03T08:45:00Z", "reason_code": "SENSOR"}])
    u = do_import(settings, small_org, "d3.csv", csv_bytes(changed), kind="downtime", conflict_policy="update")
    assert (u.updated_rows, u.inserted_rows) == (1, 0)
    row = conn.execute("SELECT d.duration_minutes, d.reason_code FROM downtime_events d JOIN equipment e ON e.id=d.equipment_id "
                       "JOIN production_lines l ON l.id=e.production_line_id JOIN plants pl ON pl.id=l.plant_id "
                       "WHERE pl.organisation_id=%s AND d.start_time = '2026-03-03T08:00:00Z'", (small_org,)).fetchone()
    assert (float(row["duration_minutes"]), row["reason_code"]) == (45.0, "SENSOR")


def test_downtime_update_cannot_grow_into_the_next_event(conn, settings, small_org):
    base = {"plant_code": "NORTH", "line_code": "L1", "asset_code": "N1-M01", "category": "Unplanned", "reason_code": "JAM", "notes": ""}
    both = pd.DataFrame([{**base, "start_time": "2026-03-03T08:00:00Z", "end_time": "2026-03-03T09:00:00Z"},
                         {**base, "start_time": "2026-03-03T10:00:00Z", "end_time": "2026-03-03T11:00:00Z"}])
    do_import(settings, small_org, "d1.csv", csv_bytes(both), kind="downtime")
    grow = pd.DataFrame([{**base, "start_time": "2026-03-03T08:00:00Z", "end_time": "2026-03-03T10:30:00Z"}])
    r = do_import(settings, small_org, "d2.csv", csv_bytes(grow), kind="downtime", conflict_policy="update")
    assert r.updated_rows == 0 and r.rejected_rows == 1


# ---- larger, realistic load -------------------------------------------------------------------------

def test_full_structure_sixty_days_imports_and_reconciles(conn, settings, org):
    data = generate(START, 60, seed=11)
    r = do_import(settings, org, "p.csv", csv_bytes(data.production))
    d = do_import(settings, org, "d.csv", csv_bytes(data.downtime), kind="downtime")
    assert r.rejected_rows == 0 and d.rejected_rows == 0
    # What was loaded equals what the file says, measured independently with SQL.
    units = conn.execute("SELECT sum(units_produced) s FROM production_records p JOIN equipment e ON e.id=p.equipment_id "
                         "JOIN production_lines l ON l.id=e.production_line_id JOIN plants pl ON pl.id=l.plant_id WHERE pl.organisation_id=%s", (org,)).fetchone()["s"]
    assert int(units) == int(data.production["units_produced"].sum())
    assert records_for(conn, org) == len(data.production) > 3000
