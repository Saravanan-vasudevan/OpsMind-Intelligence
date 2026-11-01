"""Two detectors over the equipment-day panel.

robust_z  : each machine's value is compared with what that machine usually does on the SAME WEEKDAY (median of the
            previous 8 same weekdays), and the difference is scaled by the recent spread of such differences (MAD).
            Weekday-aware because weekends and a weekly maintenance day otherwise look "abnormal" every week.
            Easy to explain, no training, direction-aware.
isolation_forest : a multivariate model over all three metrics (weekday effect removed, scaled per machine). Catches
            combinations, but its reason has to be reconstructed from the metrics.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .panel import BAD_DIRECTION, LABELS, METRICS

# Smallest spread (in the metric's own units) we will divide by. Without a floor, a machine whose recent differences were
# almost identical gets an enormous z for an ordinary wobble. These are practical "smallest change worth noticing" values,
# chosen from how the metrics are used on the shop floor. (The downtime floor was lowered from 0.02 to 0.01 after the first benchmark run, when the metric changed from daily to trailing-7-day; see docs/DEV_LOG.md.)
SCALE_FLOOR = {"attainment": 0.03, "defect_rate": 0.005, "downtime_share": 0.01}
MAD_TO_SIGMA = 1.4826
DEFAULTS = {
    "weekday_weeks": 8,       # same weekdays used for the expected value
    "min_weekday_obs": 4,     # ...and how many must exist
    "residual_days": 28,      # calendar window for the spread of differences
    "min_residuals": 14,
    "threshold": 3.5,
}
# History needed before the first day that can be judged, in days: 8 weeks of weekdays plus the residual window.
LOOKBACK_DAYS = 7 * DEFAULTS["weekday_weeks"] + DEFAULTS["residual_days"]

_FMT = {"attainment": lambda v: f"{v * 100:.1f}%", "defect_rate": lambda v: f"{v * 100:.1f}%", "downtime_share": lambda v: f"{v * 100:.1f}%"}


def _mad(a: np.ndarray) -> float:
    return float(np.nanmedian(np.abs(a - np.nanmedian(a))))


def expected_same_weekday(s: pd.Series, weeks: int, min_obs: int) -> pd.Series:
    """Median of the same weekday over the previous `weeks` weeks (the day itself is never included). `s` has a daily index."""
    stack = np.vstack([s.shift(7 * k).to_numpy() for k in range(1, weeks + 1)])
    seen = (~np.isnan(stack)).sum(axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        median = np.nanmedian(stack, axis=0)
    median[seen < min_obs] = np.nan
    return pd.Series(median, index=s.index)


def robust_z(panel: pd.DataFrame, start, end, threshold: float = DEFAULTS["threshold"]) -> pd.DataFrame:
    """Flag equipment-days in [start, end] that are `threshold` robust standard deviations worse than the machine's own
    same-weekday norm. Needs about LOOKBACK_DAYS of earlier history per machine; with less, nothing is flagged."""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    out = []
    for (equipment_id, asset), group in panel.groupby(["equipment_id", "asset_code"], sort=False):
        daily = group.set_index("day").sort_index()
        index = pd.date_range(daily.index.min(), daily.index.max(), freq="D")
        for metric in METRICS:
            s = daily[metric].reindex(index)
            expected = expected_same_weekday(s, DEFAULTS["weekday_weeks"], DEFAULTS["min_weekday_obs"])
            residual = s - expected
            spread = residual.shift(1).rolling(DEFAULTS["residual_days"], min_periods=DEFAULTS["min_residuals"]).apply(_mad, raw=True)
            scale = np.maximum(spread * MAD_TO_SIGMA, SCALE_FLOOR[metric])
            z = residual / scale
            hit = (z * BAD_DIRECTION[metric] >= threshold) & (s.index >= start) & (s.index <= end)
            for day in s.index[hit]:
                out.append({
                    "equipment_id": equipment_id, "asset_code": asset, "day": day, "metric": metric, "value": float(s[day]),
                    "baseline": float(expected[day]), "score": float(z[day]), "method": "robust_z",
                    "explanation": (f"{LABELS[metric]} was {_FMT[metric](s[day])} against a typical {_FMT[metric](expected[day])} for a "
                                    f"{day.day_name()} (median of this machine's previous {DEFAULTS['weekday_weeks']} {day.day_name()}s); "
                                    f"that is {abs(z[day]):.1f} robust standard deviations {'below' if BAD_DIRECTION[metric] < 0 else 'above'} normal.")})
    return _finish(out)


def isolation_forest(panel: pd.DataFrame, start, end, contamination: float = 0.02, random_state: int = 0) -> pd.DataFrame:
    """Flag the `contamination` fraction of equipment-days that are easiest to isolate in the three-metric space.
    Each metric is first expressed as a deviation from that machine's usual value for the weekday, in robust units, so a
    naturally high-defect machine, or an ordinary Wednesday, is not flagged for being itself.
    Unlike robust_z this looks at the whole supplied panel at once (batch), so it also needs enough history to be meaningful."""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    frame = panel.dropna(subset=METRICS).copy()
    if len(frame) < 50:
        return _finish([])
    frame["dow"] = frame["day"].dt.dayofweek
    for metric in METRICS:
        norm = frame.groupby(["equipment_id", "dow"])[metric].transform("median")
        resid = frame[metric] - norm
        scale = np.maximum(resid.abs().groupby(frame["equipment_id"]).transform("median") * MAD_TO_SIGMA, SCALE_FLOOR[metric])
        frame[f"norm_{metric}"] = norm
        frame[f"bad_{metric}"] = resid / scale * BAD_DIRECTION[metric]       # positive = deviating in the harmful direction
    features = frame[[f"bad_{m}" for m in METRICS]].to_numpy()
    model = IsolationForest(n_estimators=200, contamination=contamination, random_state=random_state).fit(features)
    frame["score"] = -model.score_samples(features)          # higher = more anomalous
    flagged = frame[(model.predict(features) == -1) & (frame["day"] >= start) & (frame["day"] <= end)]
    out = []
    for row in flagged.itertuples(index=False):
        bads = {m: getattr(row, f"bad_{m}") for m in METRICS}
        worst = max(bads, key=bads.get)
        if bads[worst] <= 1.0:      # unusual only in a good direction, or by less than one robust SD: not a problem to report
            continue
        out.append({
            "equipment_id": row.equipment_id, "asset_code": row.asset_code, "day": row.day, "metric": worst,
            "value": float(getattr(row, worst)), "baseline": float(getattr(row, f"norm_{worst}")),
            "score": float(row.score), "method": "isolation_forest",
            "explanation": (f"This machine-day is unusual across the three metrics together (isolation score {row.score:.2f}). "
                            f"The largest harmful deviation is {LABELS[worst].lower()}: {_FMT[worst](getattr(row, worst))} against this machine's usual "
                            f"{_FMT[worst](getattr(row, f'norm_{worst}'))} for that weekday.")})
    return _finish(out)


def _finish(rows: list[dict]) -> pd.DataFrame:
    cols = ["equipment_id", "asset_code", "day", "metric", "value", "baseline", "score", "method", "explanation"]
    frame = pd.DataFrame(rows, columns=cols)
    if frame.empty:
        return frame
    return frame.reindex(frame["score"].abs().sort_values(ascending=False).index).reset_index(drop=True)


DETECTORS = {"robust_z": robust_z, "isolation_forest": isolation_forest}
