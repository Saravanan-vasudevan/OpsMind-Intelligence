using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OpsMind.Api.Infrastructure;

namespace OpsMind.Api.Tests;

/// <summary>The client is tested against a fake HTTP handler: these prove what we send and how failures are translated, not the Python service itself.</summary>
public class IntelligenceClientTests
{
    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _respond;
        public List<HttpRequestMessage> Requests { get; } = new();
        public string? LastBody { get; private set; }

        public FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) => _respond = respond;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            if (request.Content is not null) LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            return _respond(request);
        }
    }

    private static IntelligenceClient Create(FakeHandler handler, string key = "secret")
    {
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://intelligence:8000") };
        return new IntelligenceClient(http, Options.Create(new IntelligenceOptions { InternalKey = key }), NullLogger<IntelligenceClient>.Instance);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid User = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task Get_sends_the_shared_key_and_the_callers_identity_and_escapes_the_query()
    {
        var handler = new FakeHandler(_ => Json(HttpStatusCode.OK, "{}"));
        var result = await Create(handler).GetAsync(Org, User, "/forecast",
            new[] { new KeyValuePair<string, string>("metric", "units"), new KeyValuePair<string, string>("note", "a b&c") }, default);

        Assert.Equal(200, result.StatusCode);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("secret", request.Headers.GetValues("X-Internal-Key").Single());
        Assert.Equal(Org.ToString(), request.Headers.GetValues("X-Organisation-Id").Single());
        Assert.Equal(User.ToString(), request.Headers.GetValues("X-User-Id").Single());
        Assert.Equal("/forecast?metric=units&note=a%20b%26c", request.RequestUri!.PathAndQuery);
    }

    [Fact]
    public async Task Upload_sends_the_file_and_fields_as_multipart()
    {
        var handler = new FakeHandler(_ => Json(HttpStatusCode.OK, "{}"));
        await using var file = new MemoryStream(Encoding.UTF8.GetBytes("a,b\n1,2\n"));
        await Create(handler).UploadAsync(Org, null, "/imports", file, "p.csv",
            new Dictionary<string, string> { ["kind"] = "production", ["conflict_policy"] = "skip" }, default);

        var request = Assert.Single(handler.Requests);
        Assert.False(request.Headers.Contains("X-User-Id"));
        Assert.Contains("name=file", handler.LastBody);
        Assert.Contains("p.csv", handler.LastBody);
        Assert.Contains("a,b", handler.LastBody);
        Assert.Contains("conflict_policy", handler.LastBody);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(404)]
    [InlineData(413)]
    [InlineData(415)]
    [InlineData(422)]
    public async Task User_facing_statuses_are_passed_through_with_their_body(int status)
    {
        var handler = new FakeHandler(_ => Json((HttpStatusCode)status, "{\"code\":\"x\"}"));
        var result = await Create(handler).GetAsync(Org, User, "/forecast", Array.Empty<KeyValuePair<string, string>>(), default);
        Assert.Equal(status, result.StatusCode);
        Assert.Equal("{\"code\":\"x\"}", Encoding.UTF8.GetString(result.Body));
    }

    [Theory]
    [InlineData(401)]   // wrong shared key must never reach the SPA as "sign in again"
    [InlineData(403)]
    [InlineData(500)]
    [InlineData(503)]
    public async Task Other_upstream_statuses_become_a_502_without_leaking_the_body(int status)
    {
        var handler = new FakeHandler(_ => Json((HttpStatusCode)status, "{\"detail\":\"internal secret detail\"}"));
        var result = await Create(handler).GetAsync(Org, User, "/forecast", Array.Empty<KeyValuePair<string, string>>(), default);
        Assert.Equal(502, result.StatusCode);
        Assert.DoesNotContain("internal secret detail", Encoding.UTF8.GetString(result.Body));
        Assert.Contains("intelligence_error", Encoding.UTF8.GetString(result.Body));
    }

    [Fact]
    public async Task An_unreachable_service_is_503()
    {
        var handler = new FakeHandler(_ => throw new HttpRequestException("connection refused"));
        var result = await Create(handler).GetAsync(Org, User, "/forecast", Array.Empty<KeyValuePair<string, string>>(), default);
        Assert.Equal(503, result.StatusCode);
        Assert.Contains("intelligence_unavailable", Encoding.UTF8.GetString(result.Body));
    }

    [Fact]
    public async Task A_timeout_is_504()
    {
        var handler = new FakeHandler(_ => throw new TaskCanceledException("timeout"));
        var result = await Create(handler).GetAsync(Org, User, "/forecast", Array.Empty<KeyValuePair<string, string>>(), default);
        Assert.Equal(504, result.StatusCode);
    }

    [Fact]
    public async Task A_caller_cancellation_is_not_reported_as_a_timeout()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var handler = new FakeHandler(_ => throw new TaskCanceledException("cancelled"));
        await Assert.ThrowsAsync<TaskCanceledException>(() =>
            Create(handler).GetAsync(Org, User, "/forecast", Array.Empty<KeyValuePair<string, string>>(), cts.Token));
    }

    [Fact]
    public async Task Without_a_configured_key_nothing_is_sent()
    {
        var handler = new FakeHandler(_ => Json(HttpStatusCode.OK, "{}"));
        var result = await Create(handler, key: "").GetAsync(Org, User, "/forecast", Array.Empty<KeyValuePair<string, string>>(), default);
        Assert.Equal(503, result.StatusCode);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task A_download_keeps_its_file_name()
    {
        var handler = new FakeHandler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[] { 1, 2, 3 }) };
            response.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            response.Content.Headers.ContentDisposition = new System.Net.Http.Headers.ContentDispositionHeaderValue("attachment") { FileName = "\"r.xlsx\"" };
            return response;
        });
        var result = await Create(handler).GetAsync(Org, User, "/reports/operations.xlsx", Array.Empty<KeyValuePair<string, string>>(), default);
        Assert.Equal("r.xlsx", result.FileName);
        Assert.Equal(new byte[] { 1, 2, 3 }, result.Body);
    }
}
