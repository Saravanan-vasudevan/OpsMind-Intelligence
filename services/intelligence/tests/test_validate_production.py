from datetime import date
import uuid

import pandas as pd
import pytest

from opsmind_intel.etl.schema import PRODUCTION_COLUMNS
from opsmind_intel.etl.validate import Lookups, parse_date_value, parse_timestamp_value, validate_production

EQ1, EQ2, EQ_OFF = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
PLANT = uuid.uuid4()
SHIFT_DAY, SHIFT_NIGHT = uuid.uuid4(), uuid.uuid4()
TODAY = date(2026, 3, 10)

LOOKUPS = Lookups(
    equipment=pd.DataFrame([
        ("NORTH", "L1", "M1", EQ1, PLANT, "Active"),
        ("NORTH", "L1", "M2", EQ2, PLANT, "Maintenance"),
        ("NORTH", "L1", "OFF", EQ_OFF, PLANT, "Inactive"),
    ], columns=["plant_code", "line_code", "asset_code", "equipment_id", "plant_id", "status"]),
    shifts=pd.DataFrame([(PLANT, "Day", SHIFT_DAY, 480), (PLANT, "Night", SHIFT_NIGHT, 480)],
                        columns=["plant_id", "shift_name", "shift_id", "duration_minutes"]),
)


def frame(*rows: dict) -> pd.DataFrame:
    base = {"plant_code": "NORTH", "line_code": "L1", "asset_code": "M1", "shift_name": "Day", "shift_date": "2026-03-01",
            "units_produced": "100", "target_units": "120", "run_minutes": "400", "inspected_units": "", "rejected_units": "",
            "defect_type": "", "notes": ""}
    # Each default row gets its own date so rows are not accidental duplicates of each other.
    data = [{**base, "shift_date": f"2026-03-{i + 1:02d}", **r} for i, r in enumerate(rows)]
    df = pd.DataFrame(data, columns=PRODUCTION_COLUMNS).astype(str)
    df.insert(0, "row_number", range(2, len(df) + 2))
    return df


def codes(result):
    return sorted({(e.row_number, e.code) for e in result.errors})


def test_clean_row_passes_with_typed_values():
    r = validate_production(frame({"inspected_units": "100", "rejected_units": "3", "defect_type": "SURFACE"}), LOOKUPS, TODAY)
    assert r.errors == []
    row = r.valid.iloc[0]
    assert row["equipment_id"] == EQ1 and row["shift_id"] == SHIFT_DAY
    assert row["shift_date"] == date(2026, 3, 1)
    assert (row["units_produced"], row["rejected_units"]) == (100, 3)


def test_blank_optional_fields_become_null_not_zero():
    r = validate_production(frame({}), LOOKUPS, TODAY)
    row = r.valid.iloc[0]
    assert pd.isna(row["inspected_units"]) and pd.isna(row["rejected_units"])
    assert pd.isna(row["defect_type"]) and pd.isna(row["notes"])


@pytest.mark.parametrize("column", ["plant_code", "line_code", "asset_code", "shift_name", "shift_date", "units_produced", "target_units", "run_minutes"])
def test_missing_required_value_is_reported_for_that_column(column):
    r = validate_production(frame({column: ""}), LOOKUPS, TODAY)
    assert (2, "missing_required") in codes(r)
    assert any(e.column == column and e.code == "missing_required" for e in r.errors)
    assert r.valid.empty


def test_integer_parsing_accepts_excel_floats_and_rejects_fractions_and_text():
    r = validate_production(frame({"units_produced": "100.0"}, {"units_produced": "12.5"}, {"units_produced": "abc"}, {"units_produced": "1,200"}), LOOKUPS, TODAY)
    assert codes(r) == [(3, "invalid_integer"), (4, "invalid_integer"), (5, "invalid_integer")]
    assert len(r.valid) == 1


def test_negative_and_oversized_numbers_are_out_of_range():
    r = validate_production(frame({"units_produced": "-1"}, {"run_minutes": "1441"}, {"target_units": "10000001"}), LOOKUPS, TODAY)
    assert codes(r) == [(2, "out_of_range"), (3, "out_of_range"), (4, "out_of_range")]


def test_dates_iso_uk_and_invalid():
    r = validate_production(frame({"shift_date": "2026-03-02"}, {"shift_date": "03/03/2026"}, {"shift_date": "2026-02-30"},
                                  {"shift_date": "03-03-2026"}, {"shift_date": "2026-03-04 00:00:00"}), LOOKUPS, TODAY)
    assert list(r.valid["shift_date"]) == [date(2026, 3, 2), date(2026, 3, 3), date(2026, 3, 4)]
    assert codes(r) == [(4, "invalid_date"), (5, "invalid_date")]


def test_future_and_ancient_dates_are_rejected_but_tomorrow_is_allowed_like_the_api():
    r = validate_production(frame({"shift_date": "2026-03-11"}, {"shift_date": "2026-03-12"}, {"shift_date": "1999-12-31"}), LOOKUPS, TODAY)
    assert codes(r) == [(3, "future_date"), (4, "date_out_of_range")]


def test_unknown_equipment_unknown_shift_and_inactive_equipment():
    r = validate_production(frame({"asset_code": "NOPE"}, {"shift_name": "Weekend"}, {"asset_code": "OFF"}, {"plant_code": "SOUTH"}), LOOKUPS, TODAY)
    assert codes(r) == [(2, "unknown_equipment"), (3, "unknown_shift"), (4, "equipment_inactive"), (5, "unknown_equipment")]


def test_maintenance_status_is_allowed():
    assert validate_production(frame({"asset_code": "M2"}), LOOKUPS, TODAY).errors == []


def test_run_minutes_cannot_exceed_the_shift_length():
    r = validate_production(frame({"run_minutes": "481"}, {"run_minutes": "480"}), LOOKUPS, TODAY)
    assert codes(r) == [(2, "run_exceeds_shift")]
    assert "481" in r.errors[0].message and "480" in r.errors[0].message


def test_quality_must_be_complete_and_consistent():
    r = validate_production(frame({"inspected_units": "100"}, {"rejected_units": "5"}, {"inspected_units": "10", "rejected_units": "11"},
                                  {"inspected_units": "10", "rejected_units": "10"}), LOOKUPS, TODAY)
    assert codes(r) == [(2, "quality_incomplete"), (3, "quality_incomplete"), (4, "rejected_exceeds_inspected")]


def test_text_length_limits():
    r = validate_production(frame({"notes": "x" * 501}, {"defect_type": "y" * 101}), LOOKUPS, TODAY)
    assert codes(r) == [(2, "too_long"), (3, "too_long")]


def test_duplicates_in_file_keep_the_first_and_say_whether_values_differ():
    same_day = {"shift_date": "2026-03-01"}
    r = validate_production(frame(same_day, same_day, {**same_day, "units_produced": "999"}), LOOKUPS, TODAY)
    assert codes(r) == [(3, "duplicate_in_file"), (4, "duplicate_in_file")]
    assert "row 2" in r.errors[0].message and "identical" in r.errors[0].message
    assert "different" in r.errors[1].message
    assert list(r.valid["row_number"]) == [2]


def test_same_equipment_on_different_shifts_or_dates_is_not_a_duplicate():
    r = validate_production(frame({"shift_date": "2026-03-01"}, {"shift_name": "Night", "shift_date": "2026-03-01"}, {"shift_date": "2026-03-02"}), LOOKUPS, TODAY)
    assert r.errors == [] and len(r.valid) == 3


def test_one_row_can_have_several_errors_and_is_counted_once_as_rejected():
    r = validate_production(frame({"units_produced": "x", "shift_date": "bad", "asset_code": "NOPE"}), LOOKUPS, TODAY)
    assert len(r.errors) == 3 and r.rejected_row_numbers == {2}


def test_error_rows_do_not_hide_valid_rows():
    r = validate_production(frame({"units_produced": "x"}, {}), LOOKUPS, TODAY)
    assert list(r.valid["row_number"]) == [3] and r.total_rows == 2


def test_raw_value_is_kept_for_the_report():
    r = validate_production(frame({"units_produced": "abc"}), LOOKUPS, TODAY)
    assert r.errors[0].raw_value == "abc"


def test_timestamp_and_date_parsers():
    assert parse_timestamp_value("2026-03-01T08:30:00Z").hour == 8
    assert parse_timestamp_value("2026-03-01T09:30:00+01:00").hour == 8   # converted to UTC
    assert parse_timestamp_value("2026-03-01 08:30").hour == 8            # naive means UTC
    assert parse_timestamp_value("01/03/2026 08:30").month == 3           # day first
    assert parse_timestamp_value("2026-03-01") is None
    assert parse_timestamp_value("garbage") is None
    assert parse_date_value("31/02/2026") is None
