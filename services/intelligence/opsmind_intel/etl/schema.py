"""The import file formats. The frontend templates (frontend/public/templates) must match these; a test checks it."""
from __future__ import annotations

PRODUCTION_COLUMNS = [
    "plant_code", "line_code", "asset_code", "shift_name", "shift_date",
    "units_produced", "target_units", "run_minutes",
    "inspected_units", "rejected_units", "defect_type", "notes",
]
PRODUCTION_REQUIRED = PRODUCTION_COLUMNS[:8]

DOWNTIME_COLUMNS = [
    "plant_code", "line_code", "asset_code", "start_time", "end_time", "category", "reason_code", "notes",
]
DOWNTIME_REQUIRED = DOWNTIME_COLUMNS[:7]

COLUMNS = {"production": PRODUCTION_COLUMNS, "downtime": DOWNTIME_COLUMNS}
REQUIRED = {"production": PRODUCTION_REQUIRED, "downtime": DOWNTIME_REQUIRED}

# Text that means "no value" in exported spreadsheets. Matched case-insensitively after trimming.
NULL_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "--"}

MAX_UNITS = 10_000_000
MAX_RUN_MINUTES = 1440
MAX_DOWNTIME_HOURS = 24 * 7
