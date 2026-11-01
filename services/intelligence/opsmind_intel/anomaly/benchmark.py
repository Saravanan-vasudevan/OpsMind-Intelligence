"""A labelled benchmark for the detectors, built on SYNTHETIC data with anomalies injected at known places.

What this measures: whether each detector finds problems of a known size that were put into otherwise ordinary
synthetic data. What it does NOT measure: accuracy on any real plant. Real faults are messier, so treat the numbers
as a sanity check of the method and as a way to compare the two detectors, not as a promise.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from ..synthetic import generate
from .detectors import DETECTORS
from .panel import add_metrics, panel_from_frames

WARMUP_DAYS = 70            # no injections before the weekday baseline and its spread can exist
INJECTION_RATE = 0.015      # fraction of eligible equipment-days that receive an anomaly
MIN_GAP_DAYS = 3

# (kind, strength) -> how the raw panel columns are altered. "moderate" is deliberately close to ordinary variation.
EFFECTS = {
    "downtime_spike": {"moderate": (60, 120), "large": (150, 300)},          # extra unplanned minutes
    "defect_surge": {"moderate": (0.03, 0.05), "large": (0.07, 0.12)},       # extra rejected share of inspected units
    "attainment_drop": {"moderate": (0.75, 0.85), "large": (0.45, 0.65)},    # output multiplier
}


def inject(panel: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    out = panel.copy().reset_index(drop=True)
    first_day = out["day"].min() + pd.Timedelta(days=WARMUP_DAYS)
    eligible = out.index[out["day"] >= first_day].to_numpy()
    chosen = rng.choice(eligible, size=max(1, int(len(eligible) * INJECTION_RATE)), replace=False)

    labels, last_by_machine = [], {}
    kinds = list(EFFECTS)
    for idx in sorted(chosen, key=lambda i: (out.at[i, "equipment_id"], out.at[i, "day"])):
        machine, day = out.at[idx, "equipment_id"], out.at[idx, "day"]
        if machine in last_by_machine and (day - last_by_machine[machine]).days < MIN_GAP_DAYS:
            continue
        last_by_machine[machine] = day
        kind = kinds[int(rng.integers(len(kinds)))]
        strength = "large" if rng.random() < 0.5 else "moderate"
        low, high = EFFECTS[kind][strength]
        amount = float(rng.uniform(low, high))
        if kind == "downtime_spike":
            out.at[idx, "unplanned_downtime_minutes"] += amount
            lost = min(amount / max(out.at[idx, "scheduled_minutes"], 1.0), 0.9)
            out.at[idx, "units"] *= 1 - lost
        elif kind == "defect_surge":
            out.at[idx, "rejected_units"] = min(out.at[idx, "inspected_units"], out.at[idx, "rejected_units"] + out.at[idx, "inspected_units"] * amount)
        else:
            out.at[idx, "units"] *= amount
        labels.append({"equipment_id": machine, "day": day, "kind": kind, "strength": strength})
    return add_metrics(out), pd.DataFrame(labels)


# A trailing-7-day downtime metric stays elevated for a week after one bad day, so flags up to 6 days later still belong to that event.
EFFECT_DAYS = {"downtime_spike": 7, "defect_surge": 1, "attainment_drop": 1}


def _windows(labels: pd.DataFrame) -> list[tuple]:
    return [(r.equipment_id, r.day, r.day + pd.Timedelta(days=EFFECT_DAYS[r.kind] - 1), r.kind, r.strength) for r in labels.itertuples()]


def _score(hits: pd.DataFrame, labels: pd.DataFrame, population: int) -> dict:
    """Recall is per injected anomaly (found if any flag lands in its window). Precision is per flag (explained if it lands
    in some injected anomaly's window). Several flags inside one window are one event, not several false alarms."""
    windows = _windows(labels)
    flags = list(hits[["equipment_id", "day"]].itertuples(index=False)) if len(hits) else []
    explained = sum(1 for f in flags if any(f.equipment_id == m and a <= f.day <= b for m, a, b, _, _ in windows))
    found = [any(f.equipment_id == m and a <= f.day <= b for f in flags) for m, a, b, _, _ in windows]
    tp, fn = sum(found), len(found) - sum(found)
    unexplained = len(flags) - explained
    precision = explained / len(flags) if flags else None
    recall = tp / len(found) if found else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision is not None and recall is not None else None)

    def recall_for(select) -> dict:
        idx = [i for i, w in enumerate(windows) if select(w)]
        n = sum(found[i] for i in idx)
        return {"injected": len(idx), "found": n, "recall": round(n / len(idx), 3) if idx else None}

    return {"injectedFound": tp, "injectedMissed": fn, "flags": len(flags), "flagsOutsideAnyInjection": unexplained,
            "precision": None if precision is None else round(precision, 3), "recall": None if recall is None else round(recall, 3),
            "f1": None if f1 is None else round(f1, 3), "falseAlarmsPer1000MachineDays": round(1000 * unexplained / population, 1),
            "recallByStrength": {s: recall_for(lambda w, s=s: w[4] == s) for s in ("moderate", "large")},
            "recallByKind": {k: recall_for(lambda w, k=k: w[3] == k) for k in EFFECTS}}


def run_benchmark(seed: int = 2024, days: int = 180) -> dict:
    data = generate(date(2025, 1, 6), days, seed=seed, patterns=[])           # no planted patterns: ordinary variation only
    clean = panel_from_frames(data.production, data.downtime)
    injected, labels = inject(clean, seed + 1)
    start, end = injected["day"].min() + pd.Timedelta(days=WARMUP_DAYS), injected["day"].max()
    eligible = injected[injected["day"] >= start]
    clean_eligible = len(clean[clean["day"] >= start])

    results = {}
    for name, detector in DETECTORS.items():
        hits = detector(injected, start, end)
        on_clean = detector(clean, start, end)              # the same detector on the data BEFORE injection
        results[name] = {**_score(hits, labels, len(eligible)), "flagsOnCleanData": int(len(on_clean)),
                         "flagsPer1000MachineDaysOnCleanData": round(1000 * len(on_clean) / clean_eligible, 1)}
    return {
        "dataset": {"kind": "synthetic, anomalies injected", "seed": seed, "days": days, "machines": int(injected["equipment_id"].nunique()),
                    "evaluatedMachineDays": int(len(eligible)), "injectedAnomalies": int(len(labels))},
        "detectors": results,
        "limitations": [
            "Synthetic data with independent noise; real plants have drift, shift effects and correlated faults the generator does not reproduce.",
            "Each injected anomaly is a single machine-day of a known size; sustained problems behave differently (see KNOWN_LIMITATIONS). A downtime event counts as found if any flag appears within its 7-day window.",
            "Detector parameters (8-week same-weekday norm, 3.5 threshold, 2% contamination) were set from design reasoning, not tuned on this benchmark; the weekday-aware norm was added after a first run showed ordinary weekly patterns being flagged (see docs/DEV_LOG.md).",
            "Numbers show how the method behaves on data like this, not how it will perform on your data.",
        ],
    }
