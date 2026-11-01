"""The equipment-day panel the detectors work on, and the three metrics derived from it."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import numpy as np
import pandas as pd
import psycopg

METRICS = ["attainment", "defect_rate", "downtime_share"]
# Which direction is a problem. Only deviations in this direction are flagged.
BAD_DIRECTION = {"attainment": -1, "defect_rate": +1, "downtime_share": +1}
LABELS = {"attainment": "Target attainment", "defect_rate": "Defect rate",
          "downtime_share": "Unplanned downtime over the last 7 days as a share of scheduled time"}
DOWNTIME_WINDOW = "7D"


def add_metrics(panel: pd.DataFrame) -> pd.DataFrame:
    """attainment = units/target; defect_rate = rejected/inspected (both for the day);
    downtime_share = unplanned minutes / scheduled minutes summed over the machine's trailing 7 days.

    Downtime is weekly because single stoppages are ordinary, zero-inflated events: a daily ratio would flag every
    breakdown. A trailing week responds to repeated or unusually long stoppages. Each metric is NaN (never 0) when its
    denominator is zero or missing."""
    out = panel.sort_values(["equipment_id", "day"]).copy()
    out["attainment"] = out["units"] / out["target_units"].where(out["target_units"] > 0)
    out["defect_rate"] = out["rejected_units"] / out["inspected_units"].where(out["inspected_units"] > 0)
    rolled = (out.set_index("day").groupby("equipment_id")[["unplanned_downtime_minutes", "scheduled_minutes"]]
              .rolling(DOWNTIME_WINDOW).sum().reset_index())
    out["downtime_share"] = (rolled["unplanned_downtime_minutes"] / rolled["scheduled_minutes"].where(rolled["scheduled_minutes"] > 0)).to_numpy()
    return out.reset_index(drop=True)


def load_panel(conn: psycopg.Connection, organisation_id: uuid.UUID, start: date, end: date, baseline_days: int,
               plant_id: uuid.UUID | None = None, equipment_id: uuid.UUID | None = None) -> pd.DataFrame:
    rows = conn.execute(
        """SELECT equipment_id, asset_code, day, units, target_units, scheduled_minutes, inspected_units, rejected_units,
                  unplanned_downtime_minutes, failures
           FROM v_equipment_daily
           WHERE organisation_id = %s AND day BETWEEN %s AND %s
             AND (%s::uuid IS NULL OR plant_id = %s) AND (%s::uuid IS NULL OR equipment_id = %s)
           ORDER BY equipment_id, day""",
        (organisation_id, start - timedelta(days=baseline_days), end, plant_id, plant_id, equipment_id, equipment_id)).fetchall()
    cols = ["equipment_id", "asset_code", "day", "units", "target_units", "scheduled_minutes", "inspected_units", "rejected_units",
            "unplanned_downtime_minutes", "failures"]
    frame = pd.DataFrame(rows, columns=cols)
    for c in cols[3:]:
        frame[c] = pd.to_numeric(frame[c]).astype(float)
    frame["day"] = pd.to_datetime(frame["day"])
    return add_metrics(frame)


def panel_from_frames(production: pd.DataFrame, downtime: pd.DataFrame, shift_minutes: int = 480) -> pd.DataFrame:
    """Build the same panel from import-format frames (used by the synthetic benchmark; parity with SQL is tested)."""
    prod = production.assign(day=pd.to_datetime(production["shift_date"]), scheduled=shift_minutes).groupby(["asset_code", "day"]).agg(
        units=("units_produced", "sum"), target_units=("target_units", "sum"), scheduled_minutes=("scheduled", "sum"),
        inspected_units=("inspected_units", "sum"), rejected_units=("rejected_units", "sum")).reset_index()
    if downtime.empty:
        prod["unplanned_downtime_minutes"], prod["failures"] = 0.0, 0.0
    else:
        d = downtime.assign(start=pd.to_datetime(downtime["start_time"], utc=True), end=pd.to_datetime(downtime["end_time"], utc=True))
        d = d[d["category"] == "Unplanned"]
        d["day"] = d["start"].dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()
        d["minutes"] = (d["end"] - d["start"]).dt.total_seconds() / 60
        agg = d.groupby(["asset_code", "day"]).agg(unplanned_downtime_minutes=("minutes", "sum"), failures=("minutes", "size")).reset_index()
        prod = prod.merge(agg, on=["asset_code", "day"], how="left").fillna({"unplanned_downtime_minutes": 0.0, "failures": 0.0})
    prod["equipment_id"] = prod["asset_code"]
    return add_metrics(prod.astype({c: float for c in prod.columns if c not in ("asset_code", "day", "equipment_id")}))
