# Forecasting

Code: `services/intelligence/opsmind_intel/forecasting/`. API: `GET /api/intelligence/forecast?metric=&horizon=&plantId=&equipmentId=`.

## What is forecast

A **daily total** of `units` produced or `unplanned_downtime_minutes`, for all plants, one plant or one machine, taken from `v_equipment_daily`. Today's (unfinished) day is dropped. Days inside the history with no record are filled with 0 and **counted** in the response (`dataQuality.missingDays`) and in a note. Horizon: 1–28 days.

## Models

| Name | Idea |
|---|---|
| `naive` | tomorrow = today (baseline) |
| `seasonal_naive` | same weekday last week (baseline; the one every other model is compared against) |
| `seasonal_mean_4w` | average of the same weekday over the last 4 weeks |
| `holt_winters` | exponential smoothing, damped additive trend, additive weekly seasonality (statsmodels) |

## How one is chosen — no hard-coded predictions

**Rolling-origin backtest** on the series itself: 3 folds, 7 days apart. In each, every model is fitted on data up to a cut-off and asked for the next `horizon` days, which are then compared with what really happened. Training always ends before the days it is scored on (tested). Metrics per model: MAE, RMSE, WAPE (MAE ÷ total actual), bias, and **skill** (percentage by which MAE is lower than seasonal naive). The model with the lowest MAE is used; ties go to the simpler model. A model that fails to fit is reported as failed, not hidden.

The response includes every model's score so the UI can show them. If a baseline wins, the response says so.

**Required history**: `28 + horizon + 14` days (so a 14-day forecast needs 56 days). With less, the API answers **422 `insufficient_history`** with the numbers needed — there is no fallback guess.

## Interval

The shaded band is the 10th–90th percentile of the chosen model's pooled backtest errors, added to the point forecast (an 80 % interval), floored at 0. It is estimated from the same folds that chose the model, from a small number of errors, so it is **indicative and may be too narrow** — the response says so. No coverage claim is made.

## Tested

Hand-calculated model outputs; a backtest computed independently by hand for the naive model; training never sees the scored days; perfectly periodic data gives zero error and picks the simplest exact model; a constant series picks naive; noisy weekly data favours averaging; model failure handling; insufficient history; the HTTP contract (`test_api.py`); a forecast on imported synthetic data beats naive in the backtest (`test_forecasting.py`).

## Not done

No holiday/shutdown calendar, no exogenous drivers, no hierarchical reconciliation (a plant forecast is not the sum of its machines' forecasts), no probabilistic scoring (CRPS/coverage tracking).
