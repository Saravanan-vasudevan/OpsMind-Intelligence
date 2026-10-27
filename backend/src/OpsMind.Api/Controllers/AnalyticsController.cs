using Microsoft.AspNetCore.Mvc;
using OpsMind.Api.Contracts;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

[Route("api/analytics")]
public class AnalyticsController : ApiControllerBase
{
    private static readonly string[] Granularities = { "day", "week", "month" };

    private readonly AnalyticsService _analytics;

    public AnalyticsController(AnalyticsService analytics)
    {
        _analytics = analytics;
    }

    [HttpGet("summary")]
    public async Task<ActionResult<KpiSummary>> Summary([FromQuery] AnalyticsFilter filter, CancellationToken ct)
    {
        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError(nameof(filter.From), error);
        return await _analytics.GetSummaryAsync(filter, ct);
    }

    [HttpGet("trend")]
    public async Task<ActionResult<IReadOnlyList<TrendPoint>>> Trend(
        [FromQuery] AnalyticsFilter filter, [FromQuery] string granularity = "day", CancellationToken ct = default)
    {
        if (!Granularities.Contains(granularity.ToLowerInvariant()))
            return FieldError(nameof(granularity), "Granularity must be day, week or month.");

        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError(nameof(filter.From), error);
        return Ok(await _analytics.GetTrendAsync(filter, granularity, ct));
    }

    [HttpGet("plant-comparison")]
    public async Task<ActionResult<IReadOnlyList<PlantComparisonRow>>> PlantComparison([FromQuery] AnalyticsFilter filter, CancellationToken ct)
    {
        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError(nameof(filter.From), error);
        return Ok(await _analytics.GetPlantComparisonAsync(filter, ct));
    }

    [HttpGet("downtime-reasons")]
    public async Task<ActionResult<IReadOnlyList<DowntimeReasonRow>>> DowntimeReasons([FromQuery] AnalyticsFilter filter, CancellationToken ct)
    {
        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError(nameof(filter.From), error);
        return Ok(await _analytics.GetDowntimeReasonsAsync(filter, ct));
    }
}
