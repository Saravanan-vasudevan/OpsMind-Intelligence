using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

namespace OpsMind.Api.Infrastructure;

public class IntelligenceOptions
{
    public const string Section = "Intelligence";

    public string BaseUrl { get; set; } = "http://intelligence:8000";
    /// <summary>Shared secret sent as X-Internal-Key. Must equal INTERNAL_API_KEY of the Python service.</summary>
    public string InternalKey { get; set; } = string.Empty;
    public int TimeoutSeconds { get; set; } = 120;
}

/// <summary>What the browser is allowed to see of a response from the Python service: status, content type, body, file name.</summary>
public sealed record IntelligenceResult(int StatusCode, string ContentType, byte[] Body, string? FileName = null);

public interface IIntelligenceClient
{
    Task<IntelligenceResult> GetAsync(Guid organisationId, Guid? userId, string path,
        IEnumerable<KeyValuePair<string, string>> query, CancellationToken ct);

    Task<IntelligenceResult> UploadAsync(Guid organisationId, Guid? userId, string path, Stream file, string fileName,
        IReadOnlyDictionary<string, string> fields, CancellationToken ct);

    Task<bool> IsHealthyAsync(CancellationToken ct);
}

/// <summary>
/// Calls the Python intelligence service. The browser never talks to it directly: this client adds the shared key and the
/// caller's organisation/user ids (taken from the validated JWT by the controllers, never from the request).
/// Upstream failures are translated, so a wrong shared key can never look like "401 – please sign in again" to the SPA.
/// </summary>
public class IntelligenceClient : IIntelligenceClient
{
    // Statuses that carry a meaningful, user-facing problem body from the service. Everything else becomes 502.
    private static readonly HashSet<int> PassThrough = new() { 200, 400, 404, 413, 415, 422 };

    private readonly HttpClient _http;
    private readonly IntelligenceOptions _options;
    private readonly ILogger<IntelligenceClient> _logger;

    public IntelligenceClient(HttpClient http, IOptions<IntelligenceOptions> options, ILogger<IntelligenceClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public Task<IntelligenceResult> GetAsync(Guid organisationId, Guid? userId, string path,
        IEnumerable<KeyValuePair<string, string>> query, CancellationToken ct)
    {
        var url = path + BuildQuery(query);
        return SendAsync(() => new HttpRequestMessage(HttpMethod.Get, url), organisationId, userId, ct);
    }

    public Task<IntelligenceResult> UploadAsync(Guid organisationId, Guid? userId, string path, Stream file, string fileName,
        IReadOnlyDictionary<string, string> fields, CancellationToken ct)
    {
        return SendAsync(() =>
        {
            var content = new MultipartFormDataContent();
            var filePart = new StreamContent(file);
            filePart.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            content.Add(filePart, "file", fileName);
            foreach (var (name, value) in fields) content.Add(new StringContent(value, Encoding.UTF8), name);
            return new HttpRequestMessage(HttpMethod.Post, path) { Content = content };
        }, organisationId, userId, ct);
    }

    public async Task<bool> IsHealthyAsync(CancellationToken ct)
    {
        try
        {
            using var response = await _http.GetAsync("/health", ct);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    private async Task<IntelligenceResult> SendAsync(Func<HttpRequestMessage> build, Guid organisationId, Guid? userId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.InternalKey))
        {
            return Problem(503, "Intelligence service not configured", "Intelligence__InternalKey is not set on the API.", "intelligence_not_configured");
        }

        using var request = build();
        request.Headers.Add("X-Internal-Key", _options.InternalKey);
        request.Headers.Add("X-Organisation-Id", organisationId.ToString());
        if (userId is { } id) request.Headers.Add("X-User-Id", id.ToString());

        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, ct);
            var status = (int)response.StatusCode;
            var body = await response.Content.ReadAsByteArrayAsync(ct);

            if (!PassThrough.Contains(status))
            {
                _logger.LogError("Intelligence service answered {Status} for {Method} {Path}", status, request.Method, request.RequestUri);
                return Problem(502, "Intelligence service error",
                    "The analysis service could not complete the request. Try again, and contact support if it keeps happening.", "intelligence_error");
            }

            var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
            var fileName = response.Content.Headers.ContentDisposition?.FileName?.Trim('"');
            return new IntelligenceResult(status, contentType, body, fileName);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            _logger.LogError("Intelligence service timed out for {Method} {Path}", request.Method, request.RequestUri);
            return Problem(504, "Intelligence service timed out", "The analysis took too long. Try a smaller date range or file.", "intelligence_timeout");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Intelligence service unreachable for {Method} {Path}", request.Method, request.RequestUri);
            return Problem(503, "Intelligence service unavailable", "The analysis service is not reachable right now. Try again shortly.", "intelligence_unavailable");
        }
    }

    private static string BuildQuery(IEnumerable<KeyValuePair<string, string>> query)
    {
        var parts = query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}").ToList();
        return parts.Count == 0 ? string.Empty : "?" + string.Join('&', parts);
    }

    private static IntelligenceResult Problem(int status, string title, string detail, string code)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(new { type = $"urn:opsmind:{code}", title, status, detail, code });
        return new IntelligenceResult(status, "application/problem+json", Encoding.UTF8.GetBytes(json));
    }
}

public class IntelligenceHealthCheck : IHealthCheck
{
    private readonly IIntelligenceClient _client;

    public IntelligenceHealthCheck(IIntelligenceClient client)
    {
        _client = client;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) =>
        await _client.IsHealthyAsync(cancellationToken)
            ? HealthCheckResult.Healthy("Intelligence service reachable")
            : HealthCheckResult.Unhealthy("Intelligence service not reachable");
}
