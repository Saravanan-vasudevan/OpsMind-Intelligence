using Microsoft.Extensions.Diagnostics.HealthChecks;
using OpsMind.Api.Data;

namespace OpsMind.Api.Infrastructure;

public class DatabaseHealthCheck : IHealthCheck
{
    private readonly OpsMindDbContext _db;

    public DatabaseHealthCheck(OpsMindDbContext db)
    {
        _db = db;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy("Database reachable")
                : HealthCheckResult.Unhealthy("Database not reachable");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Database check failed", ex);
        }
    }
}
