# Anomaly detection

Code: `services/intelligence/opsmind_intel/anomaly/`. API: `GET /api/intelligence/anomalies` and `GET /api/intelligence/anomalies/evaluation`.

## What is checked

For every machine and day: **attainment** (units ÷ target), **defect rate** (rejected ÷ inspected) and **downtime share** (unplanned downtime ÷ scheduled minutes over the trailing 7 days; one stoppage is a single event, so a daily ratio is too spiky). A metric is `NaN` — never 0 — when its denominator is missing, and is only flagged in the harmful direction (low attainment, high defects, high downtime).

## Two methods

**`robust_z` (default).** Expected value = median of the same weekday over the previous 8 weeks (at least 4 needed). Spread = median absolute deviation of the machine's residuals over 28 days (at least 14), with a floor per metric so a very steady machine does not flag trivia. Flag when the residual exceeds 3.5 robust standard deviations. The weekday-aware baseline exists because the first version flagged ordinary weekday patterns (see `DEV_LOG.md`).

**`isolation_forest`.** scikit-learn IsolationForest (contamination 0.02, fixed seed) on per-machine, weekday-normalised features; reports only machine-days that deviate in the harmful direction. Better for combinations; harder to explain.

Every flag carries a plain-language `explanation` ("Defect rate was 9.0 % against a usual 2.0 % for this machine on a Thursday") built from the same numbers, not generated text.

## How well does it work? (synthetic benchmark — read with care)

`run_benchmark()` generates 24 machines × 180 days of ordinary variation, plants known problems (downtime spikes, defect surges, attainment drops; moderate and large) at 1.5 % of machine-days, and scores each detector. Recall = planted problem found (any flag inside its window); precision = flag explained by a planted problem. The same detector is also run on the data **before** planting, giving the false-alarm rate on clean data.

Six different random seeds (38 ± 1 planted problems each):

| seed | method | recall | precision | false alarms / 1,000 machine-days | flags / 1,000 machine-days on clean data |
|---|---|---|---|---|---|
| 2024 (the one the API returns) | robust_z | 71 % | 31 % | 26.5 | 28.8 |
| | isolation_forest | 58 % | 46 % | 10.6 | 15.9 |
| 1 | robust_z | 95 % | 55 % | 17.0 | 18.2 |
| | isolation_forest | 73 % | 71 % | 6.1 | 13.3 |
| 2 | robust_z | 77 % | 44 % | 29.2 | 33.0 |
| | isolation_forest | 67 % | 65 % | 8.3 | 18.9 |
| 3 | robust_z | 84 % | 46 % | 19.3 | 19.7 |
| | isolation_forest | 63 % | 48 % | 11.7 | 16.3 |
| 4 | robust_z | 92 % | 62 % | 16.7 | 19.3 |
| | isolation_forest | 72 % | 64 % | 8.7 | 17.4 |
| 5 | robust_z | 82 % | 41 % | 29.9 | 29.5 |
| | isolation_forest | 53 % | 48 % | 12.5 | 18.6 |

Reading it honestly:

* **`robust_z` finds most planted problems (71–95 %) but roughly half or more of its flags are not planted problems** (precision 31–62 %). With three metrics per machine-day, 17–30 flags per 1,000 machine-days appear even on clean data. In a 24-machine plant that is about one false flag every two days. It is a "worth a look" list, not an alarm.
* Large problems are found essentially always; moderate ones about half the time. Short downtime spikes are the hardest (the 7-day window blurs them).
* `isolation_forest` raises fewer false alarms but misses more.
* **This is not a clean hold-out.** I looked at benchmark results while designing the weekday-aware baseline and the 7-day downtime metric, and changed the detector after seeing them. Thresholds were set from design reasoning, but the benchmark has influenced the design, so these numbers are optimistic relative to a fresh data set. The other five seeds above were run after the design was frozen and are similar to seed 2024.
* The data is synthetic with independent noise. Real plants have drift, shift effects, correlated faults and reporting delays the generator does not reproduce. **These figures say how the method behaves on data like this, not how it will perform on yours.** There is no labelled real data in this project.

## Not done

No threshold tuning per machine, no multivariate dependence between metrics beyond the forest, no alert acknowledgement/feedback loop, no use of downtime reason text.
