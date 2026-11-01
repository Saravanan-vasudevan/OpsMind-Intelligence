import uuid
from datetime import timezone

import pandas as pd

from opsmind_intel.etl.schema import DOWNTIME_COLUMNS
from opsmind_intel.etl.validate import Lookups, validate_downtime

EQ1, EQ2, PLANT = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
LOOKUPS = Lookups(
    equipment=pd.DataFrame([("NORTH", "L1", "M1", EQ1, PLANT, "Active"), ("NORTH", "L1", "M2", EQ2, PLANT, "Active")],
                           columns=["plant_code", "line_code", "asset_code", "equipment_id", "plant_id", "status"]),
    shifts=pd.DataFrame(columns=["plant_id", "shift_name", "shift_id", "duration_minutes"]),
)


def frame(*rows):
    base = {"plant_code": "NORTH", "line_code": "L1", "asset_code": "M1", "start_time": "2026-03-01T08:00:00Z",
            "end_time": "2026-03-01T09:00:00Z", "category": "Unplanned", "reason_code": "JAM", "notes": ""}
    df = pd.DataFrame([{**base, **r} for r in rows], columns=DOWNTIME_COLUMNS).astype(str)
    df.insert(0, "row_number", range(2, len(df) + 2))
    return df


def codes(r):
    return sorted({(e.row_number, e.code) for e in r.errors})


def test_clean_row_is_typed_in_utc():
    r = validate_downtime(frame({"start_time": "2026-03-01T09:00:00+01:00", "end_time": "2026-03-01 09:30", "category": "planned"}), LOOKUPS)
    assert r.errors == []
    row = r.valid.iloc[0]
    assert row["start_time"].tzinfo == timezone.utc and row["start_time"].hour == 8
    assert row["category"] == "Planned"


def test_category_reason_and_timestamps_are_checked():
    r = validate_downtime(frame({"category": "Broken"}, {"reason_code": "bad code!"}, {"start_time": "yesterday"}, {"start_time": "2026-03-01"}), LOOKUPS)
    assert codes(r) == [(2, "invalid_category"), (3, "invalid_reason_code"), (4, "invalid_timestamp"), (5, "invalid_timestamp")]


def test_end_must_follow_start_and_events_have_a_maximum_length():
    r = validate_downtime(frame({"end_time": "2026-03-01T08:00:00Z"}, {"end_time": "2026-02-28T08:00:00Z"},
                                {"start_time": "2026-03-01T00:00:00Z", "end_time": "2026-03-20T00:00:00Z"}), LOOKUPS)
    assert codes(r) == [(2, "end_before_start"), (3, "end_before_start"), (4, "duration_too_long")]


def test_unknown_equipment():
    assert codes(validate_downtime(frame({"asset_code": "ZZ"}), LOOKUPS)) == [(2, "unknown_equipment")]


def test_duplicate_start_for_same_equipment_in_file():
    r = validate_downtime(frame({}, {"reason_code": "OTHER"}), LOOKUPS)
    assert codes(r) == [(3, "duplicate_in_file")]
    assert len(r.valid) == 1


def test_overlaps_in_file_are_rejected_but_touching_events_and_other_machines_are_fine():
    r = validate_downtime(frame(
        {},                                                                                     # 08:00-09:00
        {"start_time": "2026-03-01T08:30:00Z", "end_time": "2026-03-01T09:30:00Z"},             # overlaps row 2
        {"start_time": "2026-03-01T09:00:00Z", "end_time": "2026-03-01T10:00:00Z"},             # starts when row 2 ends: allowed
        {"asset_code": "M2", "start_time": "2026-03-01T08:30:00Z", "end_time": "2026-03-01T09:30:00Z"},  # other machine
    ), LOOKUPS)
    assert codes(r) == [(3, "overlap_in_file")]
    assert list(r.valid["row_number"]) == [2, 4, 5]


def test_a_rejected_overlapping_row_does_not_extend_the_blocking_window():
    r = validate_downtime(frame(
        {"end_time": "2026-03-01T09:00:00Z"},
        {"start_time": "2026-03-01T08:30:00Z", "end_time": "2026-03-01T15:00:00Z"},   # rejected
        {"start_time": "2026-03-01T10:00:00Z", "end_time": "2026-03-01T11:00:00Z"},   # fine: row 3 was never stored
    ), LOOKUPS)
    assert codes(r) == [(3, "overlap_in_file")]
