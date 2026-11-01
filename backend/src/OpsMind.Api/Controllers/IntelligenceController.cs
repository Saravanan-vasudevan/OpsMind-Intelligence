using Microsoft.AspNetCore.Mvc;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Infrastructure;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

/// <summary>Forecasting, anomaly detection and the Excel report. Computation happens in the Python service; this controller authenticates,
/// scopes to the caller's organisation, forwards a whitelist of parameters and audits exports.</summary>
[Route("api/intelligence")]
public class IntelligenceController : ApiControllerBase
{
    private readonly IIntelligenceClient _client;
    private readonly ICurrentUser _current;
    private readonly OpsMindDbContext _db;
    private readonly AuditService _audit;

    public IntelligenceController(IIntelligenceClient client, ICurrentUser current, OpsMindDbContext db, AuditService audit)
    {
        _client = client;
        _current = current;
        _db = db;
        _audit = audit;
    }

    [HttpGet("forecast")]
    public async Task<IActionResult> Forecast([FromQuery] string? metric, [FromQuery] int? horizon, [FromQuery] Guid? plantId,
        [FromQuery] Guid? equipmentId, CancellationToken ct)
    {
        var query = new List<KeyValuePair<string, string>>();
        Add(query, "metric", metric);
        Add(query, "horizon", horizon?.ToString());
        Add(query, "plantId", plantId?.ToString());
        Add(query, "equipmentId", equipmentId?.ToString());
        return ToResult(await _client.GetAsync(_current.OrganisationId!.Value, _current.UserId, "/forecast", query, ct));
    }

    [HttpGet("anomalies")]
    public async Task<IActionResult> Anomalies([FromQuery(Name = "from")] DateOnly? fromDate, [FromQuery(Name = "to")] DateOnly? toDate, [FromQuery] string? method,
        [FromQuery] Guid? plantId, [FromQuery] Guid? equipmentId, [FromQuery] double? threshold, [FromQuery] int? limit, CancellationToken ct)
    {
        var query = new List<KeyValuePair<string, string>>();
        Add(query, "from", fromDate?.ToString("yyyy-MM-dd"));
        Add(query, "to", toDate?.ToString("yyyy-MM-dd"));
        Add(query, "method", method);
        Add(query, "plantId", plantId?.ToString());
        Add(query, "equipmentId", equipmentId?.ToString());
        Add(query, "threshold", threshold?.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Add(query, "limit", limit?.ToString());
        return ToResult(await _client.GetAsync(_current.OrganisationId!.Value, _current.UserId, "/anomalies", query, ct));
    }

    /// <summary>How the detectors behave on labelled synthetic data. Not a statement about the caller's data.</summary>
    [HttpGet("anomalies/evaluation")]
    public async Task<IActionResult> Evaluation(CancellationToken ct) =>
        ToResult(await _client.GetAsync(_current.OrganisationId!.Value, _current.UserId, "/anomalies/evaluation", Array.Empty<KeyValuePair<string, string>>(), ct));

    [HttpGet("reports/operations.xlsx")]
    public async Task<IActionResult> OperationsReport([FromQuery(Name = "from")] DateOnly? fromDate, [FromQuery(Name = "to")] DateOnly? toDate, [FromQuery] Guid? plantId,
        [FromQuery] bool? includeAnomalies, CancellationToken ct)
    {
        var filter = new AnalyticsFilter { From = fromDate, To = toDate };
        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError("from", error);

        var query = new List<KeyValuePair<string, string>>();
        Add(query, "from", filter.From!.Value.ToString("yyyy-MM-dd"));
        Add(query, "to", filter.To!.Value.ToString("yyyy-MM-dd"));
        Add(query, "plantId", plantId?.ToString());
        Add(query, "includeAnomalies", includeAnomalies is null ? null : (includeAnomalies.Value ? "true" : "false"));

        var result = await _client.GetAsync(_current.OrganisationId!.Value, _current.UserId, "/reports/operations.xlsx", query, ct);
        if (result.StatusCode == 200)
        {
            _audit.Add("export.operations-report", "Report", null, new { filter.From, filter.To, plantId });
            await _db.SaveChangesAsync(ct);
        }
        return ToResult(result);
    }

    private static void Add(List<KeyValuePair<string, string>> query, string name, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value)) query.Add(new KeyValuePair<string, string>(name, value));
    }

    internal IActionResult ToResult(IntelligenceResult result)
    {
        if (result.StatusCode == 200 && result.FileName is not null)
        {
            return File(result.Body, result.ContentType, result.FileName);
        }
        return new ContentResult
        {
            StatusCode = result.StatusCode,
            ContentType = result.ContentType,
            Content = System.Text.Encoding.UTF8.GetString(result.Body)
        };
    }
}
