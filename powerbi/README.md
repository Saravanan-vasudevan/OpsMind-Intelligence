# Power BI assets

Power BI reads the **star schema** in the PostgreSQL `bi` schema (migration `002_imports_analytics_bi.sql`). Nothing here has been opened in
Power BI Desktop: it was not available when V2 was built. What *was* verified is the data model underneath: the views exist, join
without orphan keys, and the measures' formulas give the same numbers as the API's KPIs (`services/intelligence/tests/test_bi_model.py`,
`database/tests/analytics.test.mjs`). The Power Query (M) and DAX files are untested and should be treated as a careful first draft.

## Model

```
                 dim_date ──────────┐
                                    │ 1:*  (date_key)
dim_plant ─1:*─ dim_line ─1:*─ dim_equipment ─1:*─ fact_production ─*:1─ dim_shift
     │                              │
     └──────────────1:*─────────────┴──1:*─ fact_downtime ─*:1─ dim_date
                                                 │ *:1 (category, reason_code)
                                         dim_downtime_reason
```

| Table | Grain | Key |
|---|---|---|
| `fact_production` | one production record (machine × shift × date) | `date_key`, `equipment_id`, `shift_id`, `plant_id`, `line_id` |
| `fact_downtime` | one downtime event | `date_key` (UTC date of the start), `equipment_id`, `category + reason_code` |
| `dim_date` | one day, 2020-2035 | `date_key` (yyyymmdd) |
| `dim_plant`, `dim_line`, `dim_equipment`, `dim_shift` | one row each | uuid |
| `dim_downtime_reason` | one (category, reason_code) | composite, so create a concatenated key column or relate on `reason_code` and keep `category` as an attribute |

Relationships: single direction, dimension → fact, all one-to-many. `dim_downtime_reason` has a composite natural key: in Power Query add
`Key = [category] & "|" & [reason_code]` to both it and `fact_downtime` and relate on `Key`.

## Steps

1. Create a read-only role (`GRANT USAGE ON SCHEMA bi ...`) and the three parameters in `power_query/parameters.pq`.
2. Add each `power_query/*.pq` as a blank query (Advanced Editor) named after the file. Load `dim_date` and mark it as the date table.
3. Create the relationships above, then create the measures from `measures.dax` (one per measure; `--` and `//` both start comments in DAX). `Cumulative Unplanned Share` is the
   most intricate one and the most likely to need adjusting.
4. Suggested pages: Overview (cards for Target Attainment, Availability, Defect Rate; line chart of Units by date against the 7-day average);
   Downtime (bar chart by reason with Cumulative Unplanned Share); Reliability (matrix of machine with Failures, MTBF, MTTR, Availability).

## Why these choices

* **Measures return BLANK, not 0, when the denominator is zero** (same rule as the API), so an empty selection looks empty.
* **Row-level security** is not configured; every query filters on `OrganisationId` instead. In a shared workspace use RLS on `organisation_id`.
* **Downtime is attributed to its UTC start date**, matching the API and Excel report, so dates reconcile across the three outputs.
* Import mode is assumed (small data). DirectQuery would also work but is not needed and was not considered further.
