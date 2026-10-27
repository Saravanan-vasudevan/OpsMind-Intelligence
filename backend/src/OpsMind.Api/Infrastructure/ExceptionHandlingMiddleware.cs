using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace OpsMind.Api.Infrastructure;

/// <summary>Turns exceptions into RFC 7807 problem responses with a trace id; unexpected errors never expose internals.</summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client went away; nothing to send.
        }
        catch (Exception ex) when (!context.Response.HasStarted)
        {
            await WriteProblemAsync(context, ex);
        }
    }

    private async Task WriteProblemAsync(HttpContext context, Exception ex)
    {
        var postgres = ex as PostgresException ?? ex.InnerException as PostgresException;
        var mapped = DatabaseErrors.FromSqlState(postgres?.SqlState);

        int status;
        string title;
        string detail;
        string? constraint = null;

        if (mapped is { } known)
        {
            (status, title, detail) = known;
            constraint = postgres?.ConstraintName;
            _logger.LogWarning("Database rule violated: {SqlState} {Constraint} on {Method} {Path}",
                postgres?.SqlState, constraint, context.Request.Method, context.Request.Path);
        }
        else if (ex is BadHttpRequestException)
        {
            status = StatusCodes.Status400BadRequest;
            title = "Bad request";
            detail = "The request could not be read.";
        }
        else
        {
            status = StatusCodes.Status500InternalServerError;
            title = "Unexpected error";
            detail = "Something went wrong on the server. Quote the trace id when reporting the problem.";
            _logger.LogError(ex, "Unhandled exception on {Method} {Path} (trace {TraceId})",
                context.Request.Method, context.Request.Path, context.TraceIdentifier);
        }

        var problem = new ProblemDetails { Status = status, Title = title, Detail = detail };
        problem.Extensions["traceId"] = context.TraceIdentifier;
        if (constraint is not null) problem.Extensions["constraint"] = constraint;

        context.Response.Clear();
        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(problem, (JsonSerializerOptions?)null, "application/problem+json");
    }
}
