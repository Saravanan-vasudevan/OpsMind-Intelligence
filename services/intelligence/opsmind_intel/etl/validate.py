"""Row-level validation. Pure functions: no database access, so they are unit-testable on their own.

The rules mirror what the API enforces for hand-entered data (ProductionRecordRules.cs) so a file cannot
create a record the UI would refuse. Blank/NA values in required columns are errors; blank optional values
become NULL. Nothing is imputed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable

import numpy as np
import pandas as pd

from .errors import RowError
from .schema import MAX_DOWNTIME_HOURS, MAX_RUN_MINUTES, MAX_UNITS, PRODUCTION_REQUIRED, DOWNTIME_REQUIRED

INT_RE = re.compile(r"^[+-]?\d+(\.0+)?$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00(?:\.0+)?)?$")
UK_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
UK_TS_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
MIN_DATE = date(2000, 1, 1)


@dataclass
class ValidationResult:
    valid: pd.DataFrame
    errors: list[RowError]
    total_rows: int

    @property
    def rejected_row_numbers(self) -> set[int]:
        return {e.row_number for e in self.errors}


@dataclass
class Lookups:
    """Reference data for one organisation, loaded once per import."""
    equipment: pd.DataFrame   # plant_code, line_code, asset_code, equipment_id, plant_id, status
    shifts: pd.DataFrame      # plant_id, shift_name, shift_id, duration_minutes


# ---- value parsers ----------------------------------------------------------------------------

def parse_date_value(text: str) -> date | None:
    """ISO (2026-03-01) or UK (01/03/2026). Never guesses between day/month orders: slashes mean day first."""
    try:
        if ISO_DATE_RE.match(text):
            return date.fromisoformat(text[:10])
        m = UK_DATE_RE.match(text)
        if m:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None
    return None


def parse_timestamp_value(text: str) -> datetime | None:
    """ISO 8601 with a time (offset or Z allowed) or UK `dd/mm/yyyy hh:mm[:ss]`. Values with no offset are taken as UTC."""
    try:
        m = UK_TS_RE.match(text)
        if m:
            d, mo, y, h, mi, s = m.groups()
            return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s or 0), tzinfo=timezone.utc)
        if len(text) <= 10:  # a bare date has no time of day
            return None
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


# ---- error collection ---------------------------------------------------------------------------

class _Collector:
    def __init__(self, frame: pd.DataFrame):
        self.frame = frame
        self.errors: list[RowError] = []
        self.bad = np.zeros(len(frame), dtype=bool)
        self._rows = frame["row_number"].to_numpy()

    def add(self, mask, column: str | None, code: str, message: str | Callable[[int], str], with_raw: bool = True) -> None:
        mask = np.asarray(mask, dtype=bool)
        raw = self.frame[column].to_numpy() if (column and with_raw) else None
        for i in np.flatnonzero(mask):
            text = message(i) if callable(message) else message
            self.errors.append(RowError(int(self._rows[i]), column, code, text, (raw[i] or None) if raw is not None else None))
        self.bad |= mask

    def result(self, valid: pd.DataFrame) -> ValidationResult:
        self.errors.sort(key=lambda e: (e.row_number, e.column or ""))
        return ValidationResult(valid=valid.reset_index(drop=True), errors=self.errors, total_rows=len(self.frame))


def _blank(frame: pd.DataFrame, column: str) -> np.ndarray:
    return (frame[column] == "").to_numpy()


def _parse_int(c: _Collector, column: str, lo: int, hi: int) -> pd.Series:
    """Parse a non-blank integer column; invalid or out-of-range cells become <NA> and are reported."""
    text = c.frame[column]
    present = ~_blank(c.frame, column)
    well_formed = text.str.match(INT_RE).to_numpy()
    c.add(present & ~well_formed, column, "invalid_integer", f"{column} must be a whole number.")
    values = pd.to_numeric(text.where(present & well_formed), errors="coerce").astype("Int64")
    out_of_range = (values.notna() & ((values < lo) | (values > hi))).to_numpy()
    c.add(out_of_range, column, "out_of_range", f"{column} must be between {lo:,} and {hi:,}.")
    return values.mask(pd.Series(out_of_range, index=values.index))


def _check_text(c: _Collector, column: str, limit: int) -> None:
    c.add(c.frame[column].str.len().to_numpy() > limit, column, "too_long", f"{column} is longer than {limit} characters.", with_raw=False)


def _required(c: _Collector, columns: list[str]) -> None:
    for column in columns:
        c.add(_blank(c.frame, column), column, "missing_required", f"{column} is required.")


def _resolve_equipment(c: _Collector, lookups: Lookups, frame: pd.DataFrame, require_active: bool) -> pd.DataFrame:
    keys = ["plant_code", "line_code", "asset_code"]
    ready = ~(_blank(frame, "plant_code") | _blank(frame, "line_code") | _blank(frame, "asset_code"))
    merged = frame.merge(lookups.equipment, on=keys, how="left", validate="many_to_one")
    unknown = ready & merged["equipment_id"].isna().to_numpy()
    c.add(unknown, "asset_code",
          "unknown_equipment",
          lambda i: f"No equipment '{merged['asset_code'].iat[i]}' on line '{merged['line_code'].iat[i]}' in plant '{merged['plant_code'].iat[i]}'.",
          with_raw=False)
    if require_active:
        inactive = (merged["status"] == "Inactive").to_numpy()
        c.add(inactive, "asset_code", "equipment_inactive", "Inactive equipment cannot receive new production records.", with_raw=False)
    return merged


# ---- production --------------------------------------------------------------------------------

def validate_production(table: pd.DataFrame, lookups: Lookups, today: date | None = None) -> ValidationResult:
    today = today or datetime.now(timezone.utc).date()
    c = _Collector(table)
    _required(c, PRODUCTION_REQUIRED)

    units = _parse_int(c, "units_produced", 0, MAX_UNITS)
    target = _parse_int(c, "target_units", 0, MAX_UNITS)
    run = _parse_int(c, "run_minutes", 0, MAX_RUN_MINUTES)
    inspected = _parse_int(c, "inspected_units", 0, MAX_UNITS)
    rejected = _parse_int(c, "rejected_units", 0, MAX_UNITS)
    _check_text(c, "defect_type", 100)
    _check_text(c, "notes", 500)

    # dates
    raw_dates = c.frame["shift_date"]
    parsed = [parse_date_value(t) if t else None for t in raw_dates]
    c.add(np.array([bool(t) and p is None for t, p in zip(raw_dates, parsed)]), "shift_date", "invalid_date",
          "shift_date must be YYYY-MM-DD or DD/MM/YYYY.")
    shift_date = pd.Series(parsed, index=c.frame.index, dtype=object)
    c.add(np.array([p is not None and p > today + timedelta(days=1) for p in parsed]), "shift_date", "future_date",
          "shift_date cannot be in the future.")
    c.add(np.array([p is not None and p < MIN_DATE for p in parsed]), "shift_date", "date_out_of_range",
          f"shift_date cannot be before {MIN_DATE.isoformat()}.")

    # quality pairing
    has_i, has_r = ~_blank(c.frame, "inspected_units"), ~_blank(c.frame, "rejected_units")
    c.add(has_i != has_r, "inspected_units", "quality_incomplete", "Enter both inspected_units and rejected_units, or neither.", with_raw=False)
    both = has_i & has_r & inspected.notna().to_numpy() & rejected.notna().to_numpy()
    c.add(both & (rejected.fillna(0) > inspected.fillna(0)).to_numpy(), "rejected_units", "rejected_exceeds_inspected",
          "rejected_units cannot exceed inspected_units.")

    # reference data
    merged = _resolve_equipment(c, lookups, c.frame, require_active=True)
    shift_frame = merged[["plant_id", "shift_name"]].merge(lookups.shifts, on=["plant_id", "shift_name"], how="left")
    shift_ready = ~_blank(c.frame, "shift_name") & merged["equipment_id"].notna().to_numpy()
    c.add(shift_ready & shift_frame["shift_id"].isna().to_numpy(), "shift_name", "unknown_shift",
          lambda i: f"Shift '{c.frame['shift_name'].iat[i]}' does not exist in plant '{c.frame['plant_code'].iat[i]}'.", with_raw=False)
    duration = shift_frame["duration_minutes"]
    c.add((run.notna() & duration.notna() & (run > duration)).to_numpy(), "run_minutes", "run_exceeds_shift",
          lambda i: f"run_minutes ({int(run.iat[i])}) cannot exceed the shift length ({int(duration.iat[i])} minutes).", with_raw=False)

    work = pd.DataFrame({
        "row_number": c.frame["row_number"],
        "equipment_id": merged["equipment_id"],
        "shift_id": shift_frame["shift_id"],
        "shift_date": shift_date,
        "units_produced": units, "target_units": target, "run_minutes": run,
        "inspected_units": inspected, "rejected_units": rejected,
        "defect_type": c.frame["defect_type"].replace("", None),
        "notes": c.frame["notes"].replace("", None),
    })

    # duplicates inside the file: the first occurrence of a key stands, later ones are rejected
    keyed = work["equipment_id"].notna() & work["shift_id"].notna() & work["shift_date"].notna()
    if keyed.any():
        sub = work[keyed]
        first_row = sub.groupby(["equipment_id", "shift_id", "shift_date"])["row_number"].transform("min")
        later = pd.Series(False, index=work.index)
        later.loc[sub.index] = (sub["row_number"] != first_row).to_numpy()
        first_lookup = work.set_index("row_number")
        value_cols = ["units_produced", "target_units", "run_minutes", "inspected_units", "rejected_units"]

        def duplicate_message(i: int) -> str:
            first = int(first_row.loc[work.index[i]])
            same = first_lookup.loc[first, value_cols].fillna(-1).tolist() == work.loc[work.index[i], value_cols].fillna(-1).tolist()
            return f"Same equipment, shift and date as row {first} ({'identical values' if same else 'different values'}); only the first is kept."

        c.add(later.to_numpy(), None, "duplicate_in_file", duplicate_message)

    return c.result(work[~c.bad])


# ---- downtime ----------------------------------------------------------------------------------

def validate_downtime(table: pd.DataFrame, lookups: Lookups) -> ValidationResult:
    c = _Collector(table)
    _required(c, DOWNTIME_REQUIRED)
    _check_text(c, "notes", 500)

    category = c.frame["category"].str.lower().map({"planned": "Planned", "unplanned": "Unplanned"})
    c.add(~_blank(c.frame, "category") & category.isna().to_numpy(), "category", "invalid_category", "category must be Planned or Unplanned.")

    reason = c.frame["reason_code"]
    c.add(~_blank(c.frame, "reason_code") & ~reason.str.match(CODE_RE).to_numpy(), "reason_code", "invalid_reason_code",
          "reason_code may contain letters, numbers, hyphen and underscore only.")
    c.add(reason.str.len().to_numpy() > 40, "reason_code", "too_long", "reason_code is longer than 40 characters.", with_raw=False)

    starts, ends = [], []
    for column, bucket in (("start_time", starts), ("end_time", ends)):
        raw = c.frame[column]
        parsed = [parse_timestamp_value(t) if t else None for t in raw]
        c.add(np.array([bool(t) and p is None for t, p in zip(raw, parsed)]), column, "invalid_timestamp",
              f"{column} must be an ISO 8601 date and time (e.g. 2026-03-01T08:30:00Z) or DD/MM/YYYY HH:MM.")
        bucket.extend(parsed)
    start = pd.Series(starts, index=c.frame.index, dtype=object)
    end = pd.Series(ends, index=c.frame.index, dtype=object)
    both = np.array([s is not None and e is not None for s, e in zip(starts, ends)])
    c.add(both & np.array([s is not None and e is not None and e <= s for s, e in zip(starts, ends)]), "end_time", "end_before_start",
          "end_time must be after start_time.")
    limit = timedelta(hours=MAX_DOWNTIME_HOURS)
    c.add(both & np.array([s is not None and e is not None and e > s and (e - s) > limit for s, e in zip(starts, ends)]), "end_time",
          "duration_too_long", f"A single downtime event cannot be longer than {MAX_DOWNTIME_HOURS} hours; split it.")

    merged = _resolve_equipment(c, lookups, c.frame, require_active=False)
    work = pd.DataFrame({
        "row_number": c.frame["row_number"], "equipment_id": merged["equipment_id"],
        "start_time": start, "end_time": end, "category": category,
        "reason_code": reason, "notes": c.frame["notes"].replace("", None),
    })

    # duplicate (equipment, start) inside the file, then overlaps between remaining events
    ready = work["equipment_id"].notna() & work["start_time"].notna() & work["end_time"].notna() & ~c.bad
    dup_later = pd.Series(False, index=work.index)
    first_row = pd.Series(0, index=work.index)
    if ready.any():
        sub = work[ready]
        first_row.loc[sub.index] = sub.groupby(["equipment_id", "start_time"])["row_number"].transform("min").to_numpy()
        dup_later.loc[sub.index] = (sub["row_number"] != first_row.loc[sub.index]).to_numpy()
    c.add(dup_later.to_numpy(), None, "duplicate_in_file",
          lambda i: f"Same equipment and start_time as row {int(first_row.iat[i])}; only the first is kept.")

    ready = ready & ~pd.Series(c.bad, index=work.index)
    overlap = pd.Series(False, index=work.index)
    if ready.any():
        sub = work[ready].sort_values(["equipment_id", "start_time", "row_number"])
        for _, group in sub.groupby("equipment_id", sort=False):
            latest_end = None
            for idx, s, e in zip(group.index, group["start_time"], group["end_time"]):
                if latest_end is not None and s < latest_end:
                    overlap.loc[idx] = True
                else:
                    latest_end = e if latest_end is None else max(latest_end, e)
    c.add(overlap.to_numpy(), "start_time", "overlap_in_file",
          "Overlaps an earlier downtime event for the same equipment in this file.", with_raw=False)

    return c.result(work[~c.bad])
