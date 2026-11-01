from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import psycopg

from .backtest import MIN_TRAIN, InsufficientHistory, backtest, required_history, select_best
from .models import DESCRIPTIONS, MODELS

METRICS = {"units": "sum(units)", "unplanned_downtime_minutes": "sum(unplanned_downtime_minutes)"}
MAX_HORIZON = 28
FOLDS, STRIDE = 3, 7
INTERVAL = (0.10, 0.90)   # an 80% interval


@dataclass
class DailySeries:
    values: pd.Series          # continuous daily index
    missing_days: int
    dropped_today: bool


def load_daily_series(conn: psycopg.Connection, organisation_id: uuid.UUID, metric: str, plant_id: uuid.UUID | None = None,
                      equipment_id: uuid.UUID | None = None, history_days: int | None = None, today: date | None = None) -> DailySeries:
    if metric not in METRICS:
        raise ValueError(f"metric must be one of: {', '.join(METRICS)}")
    today = today or datetime.now(timezone.utc).date()
    rows = conn.execute(
        f"""SELECT day, {METRICS[metric]}::float8 AS value FROM v_equipment_daily
            WHERE organisation_id = %s AND (%s::uuid IS NULL OR plant_id = %s) AND (%s::uuid IS NULL OR equipment_id = %s)
              AND (%s::int IS NULL OR day >= %s::date - %s::int)
            GROUP BY day ORDER BY day""",
        (organisation_id, plant_id, plant_id, equipment_id, equipment_id, history_days, today, history_days)).fetchall()
    if not rows:
        return DailySeries(pd.Series(dtype=float), 0, False)
    series = pd.Series({pd.Timestamp(r["day"]): r["value"] for r in rows}, dtype=float)
    dropped = False
    if series.index[-1].date() >= today:        # today's records are probably still being entered
        series = series[series.index.date < today]
        dropped = True
    if series.empty:
        return DailySeries(series, 0, dropped)
    full = series.reindex(pd.date_range(series.index[0], series.index[-1], freq="D"))
    missing = int(full.isna().sum())
    return DailySeries(full.fillna(0.0), missing, dropped)


def forecast(series: DailySeries, metric: str, horizon: int, scope: dict) -> dict:
    if not 1 <= horizon <= MAX_HORIZON:
        raise ValueError(f"horizon must be between 1 and {MAX_HORIZON} days")
    y = series.values.to_numpy(dtype=float)
    scores = backtest(y, horizon, FOLDS, STRIDE)       # raises InsufficientHistory
    best = select_best(scores)

    point = np.clip(MODELS[best](y, horizon), 0, None)
    residuals = scores[best].errors.ravel()
    lo, hi = np.quantile(residuals, INTERVAL)
    lower, upper = np.clip(point + lo, 0, None), np.clip(point + hi, 0, None)

    last = series.values.index[-1]
    dates = [(last + timedelta(days=k + 1)).date().isoformat() for k in range(horizon)]
    history_tail = series.values.iloc[-60:]

    notes = [
        "Interval is the 10th–90th percentile of this model's backtest errors added to the forecast. It is estimated from the same "
        f"{FOLDS} backtest windows used to choose the model, so treat it as indicative, not as a guaranteed coverage.",
    ]
    if series.missing_days:
        notes.append(f"{series.missing_days} day(s) inside the history had no records and were treated as zero.")
    if series.dropped_today:
        notes.append("Today's records were excluded because the day is not finished.")
    seasonal = scores.get("seasonal_naive")
    if best in ("naive", "seasonal_naive"):
        notes.append("A simple baseline scored best in the backtest; the more complex models did not improve on it for this series.")
    elif seasonal and seasonal.mae and scores[best].skill_vs_seasonal_naive is not None:
        notes.append(f"Selected model's backtest MAE is {scores[best].skill_vs_seasonal_naive * 100:.0f}% lower than the same-weekday-last-week baseline.")

    return {
        "metric": metric,
        "scope": scope,
        "horizonDays": horizon,
        "selectedModel": best,
        "selectedModelDescription": DESCRIPTIONS[best],
        "intervalLevel": 0.8,
        "history": [{"date": d.date().isoformat(), "value": round(float(v), 2)} for d, v in history_tail.items()],
        "forecast": [{"date": d, "point": round(float(p), 2), "lower": round(float(l), 2), "upper": round(float(u), 2)}
                     for d, p, l, u in zip(dates, point, lower, upper)],
        "backtest": {
            "folds": FOLDS, "horizonDays": horizon, "strideDays": STRIDE,
            "models": [{
                "name": s.name, "description": DESCRIPTIONS[s.name], "selected": s.name == best, "failed": s.failed,
                "mae": None if s.failed else round(s.mae, 2), "rmse": None if s.failed else round(s.rmse, 2),
                "wape": None if s.failed or s.wape is None else round(s.wape, 4),
                "bias": None if s.failed else round(s.bias, 2),
                "skillVsSeasonalNaive": None if s.skill_vs_seasonal_naive is None else round(s.skill_vs_seasonal_naive, 4),
            } for s in scores.values()],
        },
        "dataQuality": {
            "firstDate": series.values.index[0].date().isoformat(), "lastDate": last.date().isoformat(),
            "days": int(len(series.values)), "missingDays": series.missing_days, "droppedToday": series.dropped_today,
            "requiredDays": required_history(horizon, FOLDS, STRIDE),
        },
        "notes": notes,
    }


__all__ = ["load_daily_series", "forecast", "InsufficientHistory", "MAX_HORIZON", "METRICS", "MIN_TRAIN"]
