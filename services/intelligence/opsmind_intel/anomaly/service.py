from __future__ import annotations

import uuid
from datetime import date, timedelta

import pandas as pd
import psycopg

from .detectors import DEFAULTS, DETECTORS, LOOKBACK_DAYS
from .panel import load_panel


class AnomalyParameterError(ValueError):
    pass


def detect(conn: psycopg.Connection, organisation_id: uuid.UUID, start: date, end: date, method: str = "robust_z",
           plant_id: uuid.UUID | None = None, equipment_id: uuid.UUID | None = None, threshold: float | None = None,
           limit: int = 100) -> dict:
    if method not in DETECTORS:
        raise AnomalyParameterError(f"method must be one of: {', '.join(DETECTORS)}")
    if end < start:
        raise AnomalyParameterError("'to' must not be before 'from'")
    if (end - start).days > 366:
        raise AnomalyParameterError("The date range is limited to 366 days")
    if threshold is not None and not 1.0 <= threshold <= 10.0:
        raise AnomalyParameterError("threshold must be between 1 and 10")

    panel = load_panel(conn, organisation_id, start, end, LOOKBACK_DAYS, plant_id, equipment_id)
    in_range = panel[(panel["day"] >= pd.Timestamp(start)) & (panel["day"] <= pd.Timestamp(end))]
    kwargs = {"threshold": threshold} if (threshold is not None and method == "robust_z") else {}
    hits = DETECTORS[method](panel, start, end, **kwargs) if len(panel) else pd.DataFrame()

    items = []
    for row in (hits.head(limit).itertuples(index=False) if len(hits) else []):
        items.append({
            "equipmentId": str(row.equipment_id), "assetCode": row.asset_code, "date": row.day.date().isoformat(),
            "metric": row.metric, "value": round(row.value, 4), "baseline": round(row.baseline, 4), "score": round(row.score, 2),
            "method": row.method, "explanation": row.explanation})
    return {
        "method": method, "from": start.isoformat(), "to": end.isoformat(),
        "parameters": ({"threshold": threshold if threshold is not None else DEFAULTS["threshold"], "weekdayWeeks": DEFAULTS["weekday_weeks"],
                       "residualDays": DEFAULTS["residual_days"], "lookbackDays": LOOKBACK_DAYS} if method == "robust_z" else {"contamination": 0.02}),
        "machineDaysEvaluated": int(len(in_range.dropna(subset=["attainment"]))),
        "totalFlags": int(len(hits)), "returned": len(items), "anomalies": items,
        "notes": [
            "Each flag compares a machine with its own recent history, so a machine that is always poor is not flagged for being poor.",
            "Flags are prompts to look, not diagnoses. Run the evaluation endpoint to see how the method behaves on labelled synthetic data.",
        ],
    }
