using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Services;

/// <summary>Aggregation queries. All sums run in PostgreSQL; only the grouped result is read into memory.</summary>
public class AnalyticsService
{
    private readonly OpsMindDbContext _db;

    public AnalyticsService(OpsMindDbContext db)
    {
        _db = db;
    }

    public async Task<KpiSummary> GetSummaryAsync(AnalyticsFilter filter, CancellationToken ct)
    {
        var production = await _db.ProductionRecords.AsNoTracking().Apply(filter)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Records = g.Count(),
                Units = g.Sum(p => (long)p.UnitsProduced),
                Target = g.Sum(p => (long)p.TargetUnits),
                Run = g.Sum(p => (long)p.RunMinutes),
                Scheduled = g.Sum(p => (long)p.Shift.DurationMinutes),
                Inspected = g.Sum(p => p.Quality == null ? 0L : (long)p.Quality.InspectedUnits),
                Rejected = g.Sum(p => p.Quality == null ? 0L : (long)p.Quality.RejectedUnits)
            })
            .FirstOrDefaultAsync(ct);

        var downtime = await _db.DowntimeEvents.AsNoTracking().Apply(filter)
            .GroupBy(d => d.Category)
            .Select(g => new { Category = g.Key, Minutes = g.Sum(d => d.DurationMinutes) })
            .ToListAsync(ct);

        var totals = production is null
            ? ProductionTotals.Empty
            : new ProductionTotals(production.Records, production.Units, production.Target, production.Run,
                production.Scheduled, production.Inspected, production.Rejected);

        var downtimeTotals = new DowntimeTotals(
            downtime.Where(x => x.Category == DowntimeCategory.Planned).Sum(x => x.Minutes),
            downtime.Where(x => x.Category == DowntimeCategory.Unplanned).Sum(x => x.Minutes));

        return KpiCalculator.Summarise(totals, downtimeTotals);
    }

    public async Task<IReadOnlyList<TrendPoint>> GetTrendAsync(AnalyticsFilter filter, string granularity, CancellationToken ct)
    {
        var daily = await _db.ProductionRecords.AsNoTracking().Apply(filter)
            .GroupBy(p => p.ShiftDate)
            .Select(g => new
            {
                Date = g.Key,
                Units = g.Sum(p => (long)p.UnitsProduced),
                Target = g.Sum(p => (long)p.TargetUnits),
                Inspected = g.Sum(p => p.Quality == null ? 0L : (long)p.Quality.InspectedUnits),
                Rejected = g.Sum(p => p.Quality == null ? 0L : (long)p.Quality.RejectedUnits)
            })
            .OrderBy(r => r.Date)
            .ToListAsync(ct);

        var points = daily.Select(d => new TrendPoint(d.Date, d.Units, d.Target, d.Inspected, d.Rejected,
            KpiCalculator.Ratio(d.Rejected, d.Inspected)));

        return TrendBucketing.Bucket(points, granularity);
    }

    public async Task<IReadOnlyList<PlantComparisonRow>> GetPlantComparisonAsync(AnalyticsFilter filter, CancellationToken ct)
    {
        var production = await _db.ProductionRecords.AsNoTracking().Apply(filter)
            .GroupBy(p => new { p.Equipment.ProductionLine.PlantId, p.Equipment.ProductionLine.Plant.Name })
            .Select(g => new
            {
                g.Key.PlantId,
                PlantName = g.Key.Name,
                Records = g.Count(),
                Units = g.Sum(p => (long)p.UnitsProduced),
                Target = g.Sum(p => (long)p.TargetUnits),
                Run = g.Sum(p => (long)p.RunMinutes),
                Scheduled = g.Sum(p => (long)p.Shift.DurationMinutes),
                Inspected = g.Sum(p => p.Quality == null ? 0L : (long)p.Quality.InspectedUnits),
                Rejected = g.Sum(p => p.Quality == null ? 0L : (long)p.Quality.RejectedUnits)
            })
            .ToListAsync(ct);

        var downtime = await _db.DowntimeEvents.AsNoTracking().Apply(filter)
            .GroupBy(d => new { d.Equipment.ProductionLine.PlantId, d.Category })
            .Select(g => new { g.Key.PlantId, g.Key.Category, Minutes = g.Sum(d => d.DurationMinutes) })
            .ToListAsync(ct);

        return production
            .Select(p =>
            {
                var planned = downtime.Where(d => d.PlantId == p.PlantId && d.Category == DowntimeCategory.Planned).Sum(d => d.Minutes);
                var unplanned = downtime.Where(d => d.PlantId == p.PlantId && d.Category == DowntimeCategory.Unplanned).Sum(d => d.Minutes);
                return new PlantComparisonRow(
                    p.PlantId,
                    p.PlantName,
                    p.Units,
                    p.Target,
                    KpiCalculator.Ratio(p.Units, p.Target),
                    KpiCalculator.Ratio(p.Run, p.Scheduled),
                    KpiCalculator.Availability(p.Scheduled, planned, unplanned),
                    unplanned,
                    KpiCalculator.Ratio(p.Rejected, p.Inspected));
            })
            .OrderBy(r => r.PlantName)
            .ToList();
    }

    public async Task<IReadOnlyList<DowntimeReasonRow>> GetDowntimeReasonsAsync(AnalyticsFilter filter, CancellationToken ct)
    {
        var rows = await _db.DowntimeEvents.AsNoTracking().Apply(filter)
            .GroupBy(d => new { d.ReasonCode, d.Category })
            .Select(g => new { g.Key.ReasonCode, g.Key.Category, Minutes = g.Sum(d => d.DurationMinutes), Events = g.Count() })
            .OrderByDescending(r => r.Minutes)
            .Take(15)
            .ToListAsync(ct);

        return rows.Select(r => new DowntimeReasonRow(r.ReasonCode, r.Category, r.Minutes, r.Events)).ToList();
    }
}
