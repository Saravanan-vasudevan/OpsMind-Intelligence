# KPI definitions

All KPIs are computed in `Services/KpiCalculator.cs` from stored records. A ratio is **null (shown as —)** when its denominator is zero; it is never shown as 0%.

| KPI | Formula |
|---|---|
| Target attainment | units produced ÷ target units |
| Utilisation | run minutes ÷ scheduled minutes |
| Availability | (scheduled − planned downtime − unplanned downtime) ÷ (scheduled − planned downtime), floored at 0 |
| Defect rate | rejected units ÷ inspected units (only records with quality data count) |

## Choices that affect the numbers

- **Scheduled minutes** are the duration of the shift on each production record. A shift with no production record contributes nothing. This is a simplification; a real calendar of planned operating time would be better.
- **Downtime is attributed to the UTC date its event starts.** An event crossing midnight is not split.
- Planned downtime is excluded from the availability denominator (a planned maintenance window is not a loss).
- Quality figures are optional per record. Defect rate uses only records that have both inspected and rejected values.
- The shift filter on analytics is not implemented in V1.
- Ideal rate on equipment is stored but unused by V1 KPIs; there is no OEE performance factor yet.
