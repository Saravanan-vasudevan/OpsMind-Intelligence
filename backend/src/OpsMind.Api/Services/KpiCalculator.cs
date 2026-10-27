using OpsMind.Api.Contracts;

namespace OpsMind.Api.Services;

public record ProductionTotals(int Records, long Units, long Target, long RunMinutes, long ScheduledMinutes, long Inspected, long Rejected)
{
    public static readonly ProductionTotals Empty = new(0, 0, 0, 0, 0, 0, 0);
}

public record DowntimeTotals(decimal Planned, decimal Unplanned)
{
    public static readonly DowntimeTotals Empty = new(0m, 0m);
}

/// <summary>
/// KPI formulas. Aggregation happens in SQL; the ratios are computed here so the definitions are in one
/// place and can be tested. A ratio with no denominator is null, never zero, so the UI can show "no data".
/// </summary>
public static class KpiCalculator
{
    public static decimal? Ratio(decimal numerator, decimal denominator) =>
        denominator <= 0 ? null : decimal.Round(numerator / denominator, 4);

    /// <summary>
    /// Availability = (planned production time - unplanned downtime) / planned production time,
    /// where planned production time = scheduled minutes - planned downtime. Floored at zero.
    /// </summary>
    public static decimal? Availability(decimal scheduledMinutes, decimal plannedDowntime, decimal unplannedDowntime)
    {
        var plannedProductionTime = scheduledMinutes - plannedDowntime;
        if (plannedProductionTime <= 0) return null;

        var availability = (plannedProductionTime - unplannedDowntime) / plannedProductionTime;
        return decimal.Round(Math.Max(0m, availability), 4);
    }

    public static KpiSummary Summarise(ProductionTotals p, DowntimeTotals d) => new(
        RecordCount: p.Records,
        TotalUnits: p.Units,
        TotalTargetUnits: p.Target,
        TargetAttainment: Ratio(p.Units, p.Target),
        ScheduledMinutes: p.ScheduledMinutes,
        RunMinutes: p.RunMinutes,
        Utilisation: Ratio(p.RunMinutes, p.ScheduledMinutes),
        PlannedDowntimeMinutes: d.Planned,
        UnplannedDowntimeMinutes: d.Unplanned,
        Availability: Availability(p.ScheduledMinutes, d.Planned, d.Unplanned),
        InspectedUnits: p.Inspected,
        RejectedUnits: p.Rejected,
        DefectRate: Ratio(p.Rejected, p.Inspected));
}

public static class TrendBucketing
{
    /// <summary>Re-buckets daily points into weeks (starting Monday) or months. Rates are recomputed from totals, not averaged.</summary>
    public static IReadOnlyList<TrendPoint> Bucket(IEnumerable<TrendPoint> daily, string granularity)
    {
        Func<DateOnly, DateOnly> bucketStart = granularity.ToLowerInvariant() switch
        {
            "week" => d => d.AddDays(-(((int)d.DayOfWeek + 6) % 7)),
            "month" => d => new DateOnly(d.Year, d.Month, 1),
            _ => d => d
        };

        return daily
            .GroupBy(p => bucketStart(p.Date))
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                var inspected = g.Sum(p => p.InspectedUnits);
                var rejected = g.Sum(p => p.RejectedUnits);
                return new TrendPoint(g.Key, g.Sum(p => p.Units), g.Sum(p => p.TargetUnits), inspected, rejected,
                    KpiCalculator.Ratio(rejected, inspected));
            })
            .ToList();
    }
}
