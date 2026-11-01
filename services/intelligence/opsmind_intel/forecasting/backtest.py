"""Rolling-origin backtesting: refit at several past cut-offs and score the forecasts against what really happened."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .models import MODELS


class InsufficientHistory(Exception):
    def __init__(self, required: int, available: int):
        super().__init__(f"At least {required} days of history are needed for this horizon; {available} available.")
        self.required = required
        self.available = available


MIN_TRAIN = 28


@dataclass
class ModelScore:
    name: str
    mae: float
    rmse: float
    wape: float | None        # sum(|error|) / sum(actual); None when the actuals sum to zero
    bias: float               # mean(actual - forecast): positive means the model under-forecasts
    skill_vs_seasonal_naive: float | None
    errors: np.ndarray        # (folds, horizon) actual - forecast, kept for interval estimation
    failed: str | None = None


def required_history(horizon: int, folds: int, stride: int) -> int:
    return MIN_TRAIN + horizon + (folds - 1) * stride


def backtest(y: np.ndarray, horizon: int, folds: int = 3, stride: int = 7) -> dict[str, ModelScore]:
    need = required_history(horizon, folds, stride)
    if len(y) < need:
        raise InsufficientHistory(need, len(y))

    origins = [len(y) - horizon - (folds - 1 - k) * stride for k in range(folds)]   # oldest first
    scores: dict[str, ModelScore] = {}
    for name, model in MODELS.items():
        errors, actuals, failed = [], [], None
        for origin in origins:
            try:
                prediction = np.clip(model(y[:origin], horizon), 0, None)
            except Exception as exc:  # a model that cannot be fitted is reported, not hidden
                failed = f"{type(exc).__name__}"
                break
            actual = y[origin:origin + horizon]
            errors.append(actual - prediction)
            actuals.append(actual)
        if failed:
            scores[name] = ModelScore(name, float("nan"), float("nan"), None, float("nan"), None, np.empty((0, horizon)), failed)
            continue
        err, act = np.vstack(errors), np.vstack(actuals)
        total = float(np.abs(act).sum())
        scores[name] = ModelScore(
            name=name, mae=float(np.abs(err).mean()), rmse=float(np.sqrt((err ** 2).mean())),
            wape=float(np.abs(err).sum() / total) if total > 0 else None, bias=float(err.mean()),
            skill_vs_seasonal_naive=None, errors=err)

    baseline = scores.get("seasonal_naive")
    for score in scores.values():
        if not score.failed and baseline and not baseline.failed and baseline.mae > 0:
            score.skill_vs_seasonal_naive = 1.0 - score.mae / baseline.mae
    return scores


def select_best(scores: dict[str, ModelScore]) -> str:
    """Lowest MAE wins; MODELS is ordered simple to complex so an exact tie goes to the simpler model."""
    candidates = [(s.mae, i, n) for i, (n, s) in enumerate(scores.items()) if not s.failed]
    if not candidates:
        raise RuntimeError("No forecasting model could be fitted")
    return min(candidates)[2]
