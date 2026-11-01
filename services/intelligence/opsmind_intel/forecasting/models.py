"""Forecasting models for a daily series with weekly seasonality. Each takes the training array and a horizon."""
from __future__ import annotations

import warnings
from typing import Callable

import numpy as np

SEASON = 7


def naive(train: np.ndarray, horizon: int) -> np.ndarray:
    """Tomorrow looks like today. The weakest sensible baseline."""
    return np.full(horizon, train[-1], dtype=float)


def seasonal_naive(train: np.ndarray, horizon: int) -> np.ndarray:
    """Each future day equals the same weekday last week."""
    last_week = train[-SEASON:]
    return np.array([last_week[k % SEASON] for k in range(horizon)], dtype=float)


def seasonal_mean(train: np.ndarray, horizon: int, weeks: int = 4) -> np.ndarray:
    """Each future day equals the average of the same weekday over the last `weeks` weeks."""
    usable = min(weeks, len(train) // SEASON)
    block = train[len(train) - usable * SEASON:].reshape(usable, SEASON)
    profile = block.mean(axis=0)
    return np.array([profile[k % SEASON] for k in range(horizon)], dtype=float)


def holt_winters(train: np.ndarray, horizon: int) -> np.ndarray:
    """Additive damped-trend, additive weekly seasonality (exponential smoothing, statsmodels)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = ExponentialSmoothing(train, trend="add", damped_trend=True, seasonal="add", seasonal_periods=SEASON,
                                   initialization_method="estimated").fit(optimized=True)
        forecast = np.asarray(fit.forecast(horizon), dtype=float)
    if not np.all(np.isfinite(forecast)):
        raise ValueError("Holt-Winters produced non-finite values")
    return forecast


# Listed from simplest to most complex; ties in the backtest go to the simpler model.
MODELS: dict[str, Callable[[np.ndarray, int], np.ndarray]] = {
    "naive": naive,
    "seasonal_naive": seasonal_naive,
    "seasonal_mean_4w": seasonal_mean,
    "holt_winters": holt_winters,
}

DESCRIPTIONS = {
    "naive": "Repeats the last observed day.",
    "seasonal_naive": "Repeats the same weekday from last week.",
    "seasonal_mean_4w": "Average of the same weekday over the last four weeks.",
    "holt_winters": "Exponential smoothing with damped trend and weekly seasonality.",
}
