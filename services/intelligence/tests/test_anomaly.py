from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from opsmind_intel.anomaly.benchmark import inject, run_benchmark
from opsmind_intel.anomaly.detectors import isolation_forest, robust_z
from opsmind_intel.anomaly.panel import add_metrics, load_panel, panel_from_frames
from opsmind_intel.anomaly.service import AnomalyParameterError, detect
from opsmind_intel.etl.pipeline import run_import
from opsmind_intel.synthetic import Pattern, default_patterns, generate, machine_specs


def steady_panel(days=110, machine="A", seed=0, **override):
    rng = np.random.default_rng(seed)
    base = pd.DataFrame({
        "equipment_id": machine, "asset_code": machine, "day": pd.date_range("2026-01-01", periods=days),
        "units": 900 + rng.normal(0, 15, days), "target_units": 1000.0, "scheduled_minutes": 480.0,
        "inspected_units": 900.0, "rejected_units": 18 + rng.normal(0, 2, days).round(), "unplanned_downtime_minutes": 10 + rng.normal(0, 4, days).clip(-10),
        "failures": 0.0})
    for k, (i, v) in override.items():
        base.loc[i, k] = v
    return add_metrics(base)


# ---- metrics ------------------------------------------------------------------------------------------------

def test_metrics_are_nan_not_zero_when_the_denominator_is_missing():
    p = add_metrics(pd.DataFrame({"equipment_id": ["A", "A"], "day": pd.to_datetime(["2026-01-01", "2026-01-02"]),
                                  "units": [10.0, 10.0], "target_units": [0.0, 20.0], "inspected_units": [0.0, 10.0], "rejected_units": [0.0, 1.0],
                                  "unplanned_downtime_minutes": [5.0, 5.0], "scheduled_minutes": [0.0, 100.0]}))
    assert p["attainment"].isna().tolist() == [True, False] and p["defect_rate"].isna().tolist() == [True, False]
    assert p["attainment"].iloc[1] == 0.5 and p["defect_rate"].iloc[1] == 0.1


def test_downtime_share_is_a_trailing_seven_day_ratio_per_machine():
    days = pd.date_range("2026-01-01", periods=10)
    a = pd.DataFrame({"equipment_id": "A", "day": days, "units": 1.0, "target_units": 1.0, "inspected_units": 1.0, "rejected_units": 0.0,
                      "unplanned_downtime_minutes": [0, 0, 60, 0, 0, 0, 0, 0, 0, 0.0], "scheduled_minutes": 100.0})
    b = a.assign(equipment_id="B", unplanned_downtime_minutes=0.0)
    p = add_metrics(pd.concat([a, b])).set_index(["equipment_id", "day"])["downtime_share"]
    assert p[("A", days[2])] == pytest.approx(60 / 300)            # days 1-3: 60 of 300 scheduled minutes
    assert p[("A", days[6])] == pytest.approx(60 / 700)            # the full 7-day window
    assert p[("A", days[8])] == pytest.approx(60 / 700)            # day 3 is still inside the window ending day 9
    assert p[("A", days[9])] == pytest.approx(0)                   # ...and has left it one day later
    assert p[("B", days[2])] == 0                                  # machines never leak into each other


# ---- robust z ------------------------------------------------------------------------------------------------

def test_ordinary_noise_is_not_flagged():
    hits = robust_z(steady_panel(), "2026-03-01", "2026-04-15")
    assert len(hits) <= 1


def test_a_downtime_spike_is_flagged_with_a_plain_explanation():
    p = steady_panel(unplanned_downtime_minutes=(90, 200.0))
    p = add_metrics(p)
    hits = robust_z(p, "2026-03-01", "2026-04-15")
    row = hits[(hits["metric"] == "downtime_share") & (hits["day"] == pd.Timestamp("2026-04-01"))].iloc[0]
    assert row["score"] > 3.5
    assert "Unplanned downtime over the last 7 days" in row["explanation"] and "robust standard deviations above normal" in row["explanation"]


def test_a_regular_weekly_pattern_is_not_flagged():
    p = steady_panel()
    wednesday = p["day"].dt.dayofweek == 2
    p.loc[wednesday, "units"] *= 0.8                                   # every Wednesday is 20% lower (weekly maintenance)
    p.loc[p["day"].dt.dayofweek == 6, "unplanned_downtime_minutes"] += 100   # and Sundays always lose 100 min
    p = add_metrics(p)
    assert len(robust_z(p, "2026-03-01", "2026-04-15")) <= 1


def test_a_wednesday_that_is_worse_than_other_wednesdays_is_flagged():
    p = steady_panel()
    wed = p.index[p["day"].dt.dayofweek == 2]
    p.loc[wed, "units"] *= 0.8
    target_row = [i for i in wed if p.at[i, "day"] >= pd.Timestamp("2026-04-01")][0]
    p.at[target_row, "units"] *= 0.5                                   # half of a normal (already low) Wednesday
    hits = robust_z(add_metrics(p), "2026-03-01", "2026-04-15")
    assert p.at[target_row, "day"] in set(hits[hits["metric"] == "attainment"]["day"])
    assert "Wednesday" in hits.iloc[0]["explanation"]


def test_flags_only_in_the_harmful_direction():
    p = add_metrics(steady_panel(units=(90, 1500.0), rejected_units=(91, 0.0)))   # unusually GOOD output and zero defects
    assert robust_z(p, "2026-03-01", "2026-04-15").empty


def test_low_attainment_and_high_defects_are_flagged():
    p = add_metrics(steady_panel(units=(90, 500.0), rejected_units=(90, 120.0)))
    metrics = set(robust_z(p, "2026-03-01", "2026-04-15")["metric"])
    assert {"attainment", "defect_rate"} <= metrics


def test_the_baseline_excludes_the_day_being_judged():
    spike = add_metrics(steady_panel(unplanned_downtime_minutes=(90, 400.0)))
    assert not robust_z(spike, "2026-04-01", "2026-04-01").empty


def test_range_limits_what_is_reported_but_not_the_baseline():
    p = add_metrics(steady_panel(unplanned_downtime_minutes=(90, 400.0)))
    assert robust_z(p, "2026-04-08", "2026-04-15").empty        # the weekly metric stays high for 7 days, then recovers


def test_not_enough_history_means_no_flags_rather_than_guesses():
    p = add_metrics(steady_panel(days=10, unplanned_downtime_minutes=(8, 400.0)))
    assert robust_z(p, "2026-01-01", "2026-01-10").empty


def test_a_machine_is_compared_with_itself_not_with_its_neighbours():
    a = steady_panel(machine="A", seed=1)
    b = steady_panel(machine="B", seed=2)
    b["rejected_units"] = b["rejected_units"] * 5          # B is simply a high-defect machine all the time
    b = add_metrics(b)
    assert robust_z(pd.concat([a, b]), "2026-03-01", "2026-04-15").query("asset_code == 'B'").empty


def test_zero_variation_history_does_not_explode():
    p = steady_panel()
    p["rejected_units"] = 18.0
    p = add_metrics(p)
    p.loc[90, "rejected_units"] = 19.0                      # one extra reject in an otherwise constant series
    assert robust_z(add_metrics(p), "2026-03-01", "2026-04-15").query("metric == 'defect_rate'").empty


# ---- isolation forest ---------------------------------------------------------------------------------------

def test_isolation_forest_flags_a_multivariate_outlier_and_explains_it():
    rows = []
    for m in range(6):
        rows.append(steady_panel(days=120, machine=f"M{m}", seed=m))
    p = pd.concat(rows, ignore_index=True)
    i = p.index[(p["asset_code"] == "M0") & (p["day"] == pd.Timestamp("2026-04-15"))][0]
    p.loc[i, ["units", "rejected_units", "unplanned_downtime_minutes"]] = [300.0, 150.0, 240.0]
    p = add_metrics(p)
    hits = isolation_forest(p, "2026-02-01", "2026-04-30")
    top = hits.iloc[0]
    assert top["asset_code"] == "M0" and top["day"] == pd.Timestamp("2026-04-15")
    assert "unusual across the three metrics" in top["explanation"]
    assert len(hits) <= 0.03 * len(p)                       # the contamination setting bounds the number of alerts


def test_isolation_forest_is_deterministic():
    p = pd.concat([steady_panel(days=100, machine=f"M{m}", seed=m) for m in range(4)], ignore_index=True)
    a, b = isolation_forest(p, "2026-02-01", "2026-04-10"), isolation_forest(p, "2026-02-01", "2026-04-10")
    assert a.equals(b)


# ---- panel parity with the SQL view -----------------------------------------------------------------------------

def test_pandas_panel_equals_the_sql_view_on_the_same_data(conn, settings, org):
    data = generate(date(2026, 1, 5), 45, seed=9, patterns=default_patterns(date(2026, 2, 18)))
    run_import(settings.database_url, settings, org, None, "p.csv", data.production.to_csv(index=False).encode(), "production")
    run_import(settings.database_url, settings, org, None, "d.csv", data.downtime.to_csv(index=False).encode(), "downtime")
    sql = load_panel(conn, org, date(2026, 1, 5), date(2026, 2, 18), 0).sort_values(["asset_code", "day"]).reset_index(drop=True)
    py = panel_from_frames(data.production, data.downtime).sort_values(["asset_code", "day"]).reset_index(drop=True)
    cols = ["asset_code", "day", "units", "target_units", "scheduled_minutes", "inspected_units", "rejected_units", "unplanned_downtime_minutes", "failures"]
    pd.testing.assert_frame_equal(sql[cols], py[cols], check_dtype=False, check_exact=False, atol=1e-6)


# ---- service on imported data with planted patterns ----------------------------------------------------------------

def test_planted_patterns_in_imported_data_are_found(conn, settings, org):
    start, days = date(2026, 1, 5), 150
    end = start + timedelta(days=days - 1)
    patterns = default_patterns(end)
    data = generate(start, days, seed=21, patterns=patterns)
    run_import(settings.database_url, settings, org, None, "p.csv", data.production.to_csv(index=False).encode(), "production")
    run_import(settings.database_url, settings, org, None, "d.csv", data.downtime.to_csv(index=False).encode(), "downtime")

    out = detect(conn, org, start + timedelta(days=75), end, "robust_z", limit=10_000)
    flagged = pd.DataFrame(out["anomalies"])
    labels = data.labels.assign(day=pd.to_datetime(data.labels["day"]))

    reject = labels[labels["kind"] == "reject_boost"]
    in_window = reject.merge(flagged.assign(day=pd.to_datetime(flagged["date"])), left_on=["asset_code", "day"], right_on=["assetCode", "day"])
    found_days = in_window.query("metric == 'defect_rate'").drop_duplicates(["asset_code", "day"])
    # Recall on the planted reject surge, measured per machine-day inside the planted window. Planted effect is ~2.2x the usual rate.
    recall = len(found_days) / len(reject)
    assert recall > 0.4, f"planted defect surge recall was {recall:.2f}"

    # The failure cluster machine should be among the most-flagged machines for downtime.
    downtime_flags = flagged[flagged["metric"] == "downtime_share"].groupby("assetCode").size().sort_values(ascending=False)
    assert "N2-M03" in list(downtime_flags.index[:3])

    # Flags far from any planted window should be uncommon. Ordinary breakdowns (a normal part of this data) still produce some.
    planted = set()
    for r in labels.itertuples():
        reach = 7 if r.kind == "failure_cluster" else 1            # the trailing-7-day downtime metric stays high for a week
        planted |= {(r.asset_code, r.day + pd.Timedelta(days=k)) for k in range(reach)}
    outside = [1 for r in flagged.itertuples() if (r.assetCode, pd.Timestamp(r.date)) not in planted]
    assert len(outside) / out["machineDaysEvaluated"] < 0.06


def test_detect_validates_parameters(conn, org):
    with pytest.raises(AnomalyParameterError):
        detect(conn, org, date(2026, 3, 1), date(2026, 2, 1))
    with pytest.raises(AnomalyParameterError):
        detect(conn, org, date(2026, 1, 1), date(2026, 3, 1), method="magic")
    with pytest.raises(AnomalyParameterError):
        detect(conn, org, date(2024, 1, 1), date(2026, 3, 1))
    with pytest.raises(AnomalyParameterError):
        detect(conn, org, date(2026, 1, 1), date(2026, 3, 1), threshold=0.5)


def test_detect_on_an_empty_organisation_returns_an_empty_result(conn):
    from conftest import make_org
    empty = make_org(conn, with_structure=False)
    out = detect(conn, empty, date(2026, 1, 1), date(2026, 2, 1))
    assert out["anomalies"] == [] and out["totalFlags"] == 0


def test_detect_does_not_see_other_organisations(conn, settings, org):
    from conftest import make_org
    other = make_org(conn)
    data = generate(date(2026, 1, 5), 70, seed=3, patterns=[Pattern("failure_cluster", date(2026, 3, 1), date(2026, 3, 10), asset_code="N1-M01")])
    run_import(settings.database_url, settings, org, None, "p.csv", data.production.to_csv(index=False).encode(), "production")
    run_import(settings.database_url, settings, org, None, "d.csv", data.downtime.to_csv(index=False).encode(), "downtime")
    assert detect(conn, other, date(2026, 2, 1), date(2026, 3, 15))["totalFlags"] == 0


# ---- benchmark ------------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def benchmark():
    return run_benchmark()


def test_benchmark_reports_both_detectors_with_counts_that_add_up(benchmark):
    d = benchmark["dataset"]
    assert d["injectedAnomalies"] > 30 and d["machines"] == len(machine_specs())
    for name, r in benchmark["detectors"].items():
        assert r["injectedFound"] + r["injectedMissed"] == d["injectedAnomalies"], name
        assert r["flagsOutsideAnyInjection"] <= r["flags"]
        assert 0 <= r["precision"] <= 1 and 0 <= r["recall"] <= 1


def test_benchmark_large_anomalies_are_found_more_often_than_moderate_ones(benchmark):
    # Loose, deliberate bounds: the exact figures depend on the seed and are reported in the docs, not asserted here.
    for name, r in benchmark["detectors"].items():
        by = r["recallByStrength"]
        assert by["large"]["recall"] >= 0.8, name
        assert by["large"]["recall"] > by["moderate"]["recall"], name
        assert r["recall"] > 0.5, name
        assert r["flagsPer1000MachineDaysOnCleanData"] < 50, name


def test_injection_is_deterministic_and_respects_warmup_and_spacing():
    data = generate(date(2025, 1, 6), 120, seed=1, patterns=[])
    clean = panel_from_frames(data.production, data.downtime)
    a, la = inject(clean, 5)
    b, lb = inject(clean, 5)
    assert la.equals(lb) and a.equals(b)
    assert la["day"].min() >= clean["day"].min() + pd.Timedelta(days=35)
    for _, g in la.sort_values("day").groupby("equipment_id"):
        assert g["day"].diff().dropna().dt.days.min() >= 3 if len(g) > 1 else True
