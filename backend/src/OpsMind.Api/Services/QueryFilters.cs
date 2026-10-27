using OpsMind.Api.Contracts;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Services;

public static class QueryFilters
{
    public const int DefaultRangeDays = 30;
    public const int MaxRangeDays = 731;

    /// <summary>Fills in a default range (last 30 days) and validates it. Returns an error message or null.</summary>
    public static string? NormaliseRange(AnalyticsFilter filter, DateOnly today)
    {
        filter.To ??= today;
        filter.From ??= filter.To.Value.AddDays(-(DefaultRangeDays - 1));

        if (filter.From > filter.To) return "The start date must be on or before the end date.";
        if (filter.To.Value.DayNumber - filter.From.Value.DayNumber + 1 > MaxRangeDays)
            return $"The date range cannot exceed {MaxRangeDays} days.";
        return null;
    }

    public static IQueryable<ProductionRecord> Apply(this IQueryable<ProductionRecord> query, AnalyticsFilter f)
    {
        if (f.From is { } fromDate) query = query.Where(p => p.ShiftDate >= fromDate);
        if (f.To is { } toDate) query = query.Where(p => p.ShiftDate <= toDate);
        if (f.EquipmentId is { } equipmentId) query = query.Where(p => p.EquipmentId == equipmentId);
        if (f.LineId is { } lineId) query = query.Where(p => p.Equipment.ProductionLineId == lineId);
        if (f.PlantId is { } plantId) query = query.Where(p => p.Equipment.ProductionLine.PlantId == plantId);
        return query;
    }

    /// <summary>Downtime is attributed to the date (UTC) on which it starts.</summary>
    public static IQueryable<DowntimeEvent> Apply(this IQueryable<DowntimeEvent> query, AnalyticsFilter f)
    {
        if (f.From is { } fromDate)
        {
            var fromUtc = fromDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            query = query.Where(d => d.StartTime >= fromUtc);
        }

        if (f.To is { } toDate)
        {
            var beforeUtc = toDate.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            query = query.Where(d => d.StartTime < beforeUtc);
        }

        if (f.EquipmentId is { } equipmentId) query = query.Where(d => d.EquipmentId == equipmentId);
        if (f.LineId is { } lineId) query = query.Where(d => d.Equipment.ProductionLineId == lineId);
        if (f.PlantId is { } plantId) query = query.Where(d => d.Equipment.ProductionLine.PlantId == plantId);
        return query;
    }
}
