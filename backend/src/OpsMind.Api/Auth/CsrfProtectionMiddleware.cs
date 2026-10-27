using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace OpsMind.Api.Auth;

/// <summary>
/// The session lives in an HttpOnly cookie, so state-changing requests that rely on it must carry a custom header.
/// Browsers do not let a cross-site form or image request set this header, and SameSite=Strict already blocks
/// the cookie on cross-site requests. Requests using an Authorization header (not cookie-based) are not affected.
/// </summary>
public class CsrfProtectionMiddleware
{
    public const string HeaderName = "X-Requested-With";
    public const string HeaderValue = "OpsMind";

    private static readonly HashSet<string> SafeMethods =
        new(StringComparer.OrdinalIgnoreCase) { "GET", "HEAD", "OPTIONS", "TRACE" };

    private readonly RequestDelegate _next;

    public CsrfProtectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, IOptions<JwtOptions> options)
    {
        var cookieSession = context.Request.Cookies.ContainsKey(options.Value.CookieName)
                            && !context.Request.Headers.ContainsKey("Authorization");

        if (cookieSession
            && !SafeMethods.Contains(context.Request.Method)
            && context.Request.Headers[HeaderName] != HeaderValue)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(
                new ProblemDetails
                {
                    Status = StatusCodes.Status403Forbidden,
                    Title = "Missing request header",
                    Detail = $"State-changing requests must include the {HeaderName} header."
                },
                (JsonSerializerOptions?)null,
                "application/problem+json");
            return;
        }

        await _next(context);
    }
}
