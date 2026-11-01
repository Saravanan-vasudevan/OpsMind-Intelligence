from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from conftest import make_org
from opsmind_intel.etl.pipeline import run_import
from opsmind_intel.forecasting.backtest import InsufficientHistory, backtest, required_history, select_best
from opsmind_intel.forecasting.models import MODELS, naive, seasonal_mean, seasonal_naive
from opsmind_intel.forecasting.service import DailySeries, forecast, load_daily_series
from opsmind_intel.synthetic import generate

WEEK = np.array([100, 110, 105, 40, 60, 20, 30], dtype=float)   # an arbitrary weekly profile


def periodic(n, noise=0.0, seed=0):
    rng = np.random.default_rng(seed)
    return np.array([WEEK[i % 7] for i in range(n)]) + rng.normal(0, noise, n)


def as_series(values, end=date(2026, 3, 1)):
    idx = pd.date_range(end=end, periods=len(values), freq="D")
    return DailySeries(pd.Series(values, index=idx), 0, False)


# ---- the models -----------------------------------------------------------------------------------------

def test_simple_models_by_hand():
    y = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], dtype=float)
    assert list(naive(y, 3)) == [14, 14, 14]
    assert list(seasonal_naive(y, 9)) == [8, 9, 10, 11, 12, 13, 14, 8, 9]
    # same weekday averaged over the last two weeks: (1+8)/2 ... but only 2 full weeks exist
    assert list(seasonal_mean(y, 2, weeks=4)) == [4.5, 5.5]


def test_every_model_returns_the_requested_length_and_finite_values():
    y = periodic(70, noise=3)
    for name, model in MODELS.items():
        out = model(y, 14)
        assert out.shape == (14,) and np.all(np.isfinite(out)), name


# ---- backtesting -----------------------------------------------------------------------------------------

def test_backtest_matches_an_independent_hand_calculation_for_naive():
    y = np.arange(1, 71, dtype=float)       # 1..70
    h, folds, stride = 7, 3, 7
    scores = backtest(y, h, folds, stride)
    # origins: 70-7-14=49, 56, 63 -> naive predicts y[origin-1]; the series is a straight line
    expected = []
    for origin in (49, 56, 63):
        pred = y[origin - 1]
        expected.extend(abs(y[origin:origin + h] - pred))
    assert scores["naive"].mae == pytest.approx(np.mean(expected))
    assert scores["naive"].errors.shape == (3, 7)


def test_last_fold_scores_the_most_recent_days_and_training_never_sees_them():
    y = np.full(60, 10.0)
    y[-7:] = 110.0
    s = backtest(y, 7, 3, 7)
    assert np.allclose(s["naive"].errors[-1], 100.0)       # last fold: actual 110 vs forecast 10
    assert np.allclose(s["naive"].errors[0], 0.0)


def test_perfectly_periodic_data_gives_zero_error_for_seasonal_models_and_picks_the_simplest_exact_one():
    y = periodic(70)
    scores = backtest(y, 14, 3, 7)
    assert scores["seasonal_naive"].mae == pytest.approx(0)
    assert scores["naive"].mae > 10
    assert select_best(scores) == "seasonal_naive"           # ties between exact models go to the simpler one
    assert scores["seasonal_naive"].skill_vs_seasonal_naive is None      # undefined when the baseline is already perfect


def test_noisy_weekly_data_favours_averaging_over_copying_last_week():
    y = periodic(120, noise=8, seed=3)
    scores = backtest(y, 14, 3, 7)
    assert scores["seasonal_mean_4w"].mae < scores["seasonal_naive"].mae < scores["naive"].mae
    assert scores["seasonal_mean_4w"].skill_vs_seasonal_naive > 0


def test_constant_series_selects_the_naive_baseline():
    scores = backtest(np.full(70, 50.0), 14, 3, 7)
    assert select_best(scores) == "naive"
    assert scores["naive"].wape == pytest.approx(0)


def test_all_zero_series_has_no_wape_rather_than_a_division_error():
    assert backtest(np.zeros(70), 14, 3, 7)["naive"].wape is None


def test_insufficient_history_names_the_requirement():
    with pytest.raises(InsufficientHistory) as exc:
        backtest(np.ones(40), 14, 3, 7)
    assert exc.value.required == required_history(14, 3, 7) == 56 and exc.value.available == 40


# ---- the forecast payload -----------------------------------------------------------------------------------

def test_forecast_payload_is_consistent():
    series = as_series(periodic(100, noise=5, seed=1))
    out = forecast(series, "units", 14, {"plantId": None, "equipmentId": None})
    f = out["forecast"]
    assert len(f) == 14 and f[0]["date"] == (series.values.index[-1] + timedelta(days=1)).date().isoformat()
    assert all(0 <= p["lower"] <= p["point"] <= p["upper"] or p["lower"] <= p["point"] for p in f)
    assert all(p["lower"] >= 0 and p["upper"] >= p["lower"] for p in f)
    assert sum(1 for m in out["backtest"]["models"] if m["selected"]) == 1
    assert out["selectedModel"] in MODELS and len(out["history"]) == 60
    assert out["dataQuality"]["days"] == 100 and out["dataQuality"]["requiredDays"] == 56


def test_forecast_follows_the_weekly_pattern():
    series = as_series(periodic(100, noise=2, seed=2))
    out = forecast(series, "units", 7, {})
    points = [p["point"] for p in out["forecast"]]
    truth = [WEEK[(100 + k) % 7] for k in range(7)]          # the series index continues the weekly cycle
    assert np.corrcoef(points, truth)[0, 1] > 0.95


def test_forecast_validates_horizon_and_history():
    with pytest.raises(ValueError):
        forecast(as_series(periodic(100)), "units", 0, {})
    with pytest.raises(ValueError):
        forecast(as_series(periodic(100)), "units", 29, {})
    with pytest.raises(InsufficientHistory):
        forecast(as_series(periodic(30)), "units", 14, {})


def test_forecast_notes_warn_about_gaps_and_baselines():
    series = as_series(np.full(80, 5.0))
    series.missing_days = 3
    out = forecast(series, "units", 7, {})
    assert any("3 day(s)" in n for n in out["notes"]) and any("baseline scored best" in n for n in out["notes"])


# ---- from the database ------------------------------------------------------------------------------------

def import_history(conn, settings, org, days, start=date(2026, 1, 5), seed=5):
    data = generate(start, days, seed=seed)
    run_import(settings.database_url, settings, org, None, "p.csv", data.production.to_csv(index=False).encode(), "production")
    return data


def test_series_loaded_from_the_database_matches_the_imported_file(conn, settings, org):
    data = import_history(conn, settings, org, 90)
    s = load_daily_series(conn, org, "units", today=date(2026, 6, 1))
    expected = data.production.groupby("shift_date")["units_produced"].sum()
    assert s.missing_days == 0 and len(s.values) == 90
    assert list(s.values.astype(int)) == list(expected.astype(int))


def test_series_scope_filters_and_tenant_isolation(conn, settings, org):
    other = make_org(conn)
    data = import_history(conn, settings, org, 30)
    north = conn.execute("SELECT id FROM plants WHERE organisation_id=%s AND code='NORTH'", (org,)).fetchone()["id"]
    s = load_daily_series(conn, org, "units", plant_id=north, today=date(2026, 6, 1))
    expected = data.production[data.production["plant_code"] == "NORTH"].groupby("shift_date")["units_produced"].sum()
    assert list(s.values.astype(int)) == list(expected.astype(int))
    assert load_daily_series(conn, other, "units", today=date(2026, 6, 1)).values.empty


def test_today_is_dropped_and_gaps_are_filled_with_zero_and_counted(conn, settings, org):
    data = generate(date(2026, 1, 5), 40, seed=2)
    prod = data.production[data.production["shift_date"] != "2026-01-20"]      # a day with no records
    run_import(settings.database_url, settings, org, None, "p.csv", prod.to_csv(index=False).encode(), "production")
    s = load_daily_series(conn, org, "units", today=date(2026, 2, 13))          # last data day 2026-02-13 is "today"
    assert s.dropped_today and s.values.index[-1].date() == date(2026, 2, 12)
    assert s.missing_days == 1 and s.values.loc["2026-01-20"] == 0


def test_unknown_metric_is_rejected(conn, org):
    with pytest.raises(ValueError):
        load_daily_series(conn, org, "revenue")


def test_end_to_end_forecast_on_imported_data_beats_naive(conn, settings, org):
    import_history(conn, settings, org, 150)
    s = load_daily_series(conn, org, "units", today=date(2026, 12, 31))
    out = forecast(s, "units", 14, {})
    models = {m["name"]: m for m in out["backtest"]["models"]}
    # The synthetic data has built-in weekly structure (reduced weekends, Wednesday maintenance), so weekly models must win.
    assert models["seasonal_mean_4w"]["mae"] < models["naive"]["mae"]
    assert out["selectedModel"] != "naive"
    assert models[out["selectedModel"]]["wape"] < 0.2
